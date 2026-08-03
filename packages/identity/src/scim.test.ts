import {
  LIST_RESPONSE_SCHEMA,
  SCIM_DEFAULT_COUNT,
  SCIM_MAX_COUNT,
  checkScimVersion,
  decideScimCreate,
  interpretScimPatch,
  normaliseScimPage,
  parseScimFilter,
  scimActiveEffect,
  scimListResponse,
  type FilterRefusal,
  type PatchRefusal,
} from "./index"

/**
 * GE-043-005 — every decision a SCIM route will have to make.
 *
 * The two that fail silently are the ones with the most tests: an ignored filter
 * returns the whole tenant, and a deletion where a suspension was meant takes
 * somebody's history with them.
 */

const refusedFilter = (expression: string, reason: FilterRefusal) => {
  const outcome = parseScimFilter(expression)
  expect(outcome.ok).toBe(false)
  if (outcome.ok) throw new Error("expected a refusal")
  expect(outcome.reason).toBe(reason)
  expect(outcome.detail.length).toBeGreaterThan(15)
}

describe("a filter is answered or refused, never ignored", () => {
  it("parses a quoted equality filter", () => {
    const outcome = parseScimFilter('userName eq "bjensen@example.test"')
    if (!outcome.ok) throw new Error(outcome.detail)
    expect(outcome.filter).toEqual({
      attribute: "username",
      operator: "eq",
      value: "bjensen@example.test",
    })
  })

  it("parses the presence operator, which takes no value", () => {
    const outcome = parseScimFilter("externalId pr")
    if (!outcome.ok) throw new Error(outcome.detail)
    expect(outcome.filter).toEqual({ attribute: "externalid", operator: "pr", value: null })
  })

  it("parses an unquoted boolean, which SCIM allows", () => {
    const outcome = parseScimFilter("active eq false")
    if (!outcome.ok) throw new Error(outcome.detail)
    expect(outcome.filter.value).toBe("false")
  })

  it("refuses a valid operator it does not answer", () => {
    // RFC 7644 §3.4.2.2. Ignoring it returns every record in the tenant to a
    // caller who asked for one, and the caller believes it asked narrowly.
    refusedFilter('userName co "jensen"', "UNSUPPORTED_OPERATOR")
    refusedFilter('userName sw "b"', "UNSUPPORTED_OPERATOR")
    refusedFilter("meta.lastModified gt \"2026-01-01\"", "UNSUPPORTED_OPERATOR")
  })

  it("refuses something that is not an operator at all", () => {
    refusedFilter('userName zz "x"', "UNSUPPORTED_OPERATOR")
  })

  it("refuses a compound filter rather than honouring half of it", () => {
    // Dropping the second term answers a broader question than the one asked.
    refusedFilter('userName eq "a" and active eq false', "TOO_COMPLEX")
    refusedFilter('userName eq "a" or userName eq "b"', "TOO_COMPLEX")
    refusedFilter('not (userName eq "a")', "TOO_COMPLEX")
    refusedFilter('emails[type eq "work"]', "TOO_COMPLEX")
  })

  it("does not mistake an attribute containing 'and' for a compound filter", () => {
    // A guard that fired on `brandName` would refuse a legitimate filter, and a
    // guard that refuses correct input gets switched off.
    const outcome = parseScimFilter('displayName eq "Brandon"')
    expect(outcome.ok).toBe(true)
  })

  it("refuses an attribute it cannot filter on", () => {
    // Filtering an unindexed attribute is a table scan per request, and a
    // provisioning agent retries.
    refusedFilter('nickName eq "bj"', "UNFILTERABLE_ATTRIBUTE")
    refusedFilter('password eq "x"', "UNFILTERABLE_ATTRIBUTE")
  })

  it("refuses an unquoted string value", () => {
    refusedFilter("userName eq bjensen", "UNPARSEABLE")
  })

  it("refuses a value on the presence operator", () => {
    refusedFilter('externalId pr "x"', "UNPARSEABLE")
  })

  it("refuses a missing value on a comparison", () => {
    refusedFilter("userName eq", "UNPARSEABLE")
  })

  it("refuses an empty filter", () => {
    refusedFilter("   ", "UNPARSEABLE")
  })
})

describe("pagination is 1-based, and clamped rather than refused", () => {
  it("defaults when nothing is asked for", () => {
    expect(normaliseScimPage({})).toEqual({ startIndex: 1, count: SCIM_DEFAULT_COUNT })
  })

  it("raises a startIndex below 1 to 1", () => {
    // §3.4.2.4. Treating 0 as 0 repeats the first record on every sync that
    // began at zero — the sort of duplicate somebody chases for a week.
    expect(normaliseScimPage({ startIndex: 0 }).startIndex).toBe(1)
    expect(normaliseScimPage({ startIndex: -5 }).startIndex).toBe(1)
  })

  it("clamps an oversized count instead of failing the sync", () => {
    // An agent sending count=10000 is trying to finish, not attacking. A 400
    // makes a sync that could have worked fail permanently.
    expect(normaliseScimPage({ count: 10000 }).count).toBe(SCIM_MAX_COUNT)
  })

  it("allows a count of zero, which is how an agent asks for a total", () => {
    expect(normaliseScimPage({ count: 0 }).count).toBe(0)
  })

  it("survives values that are not numbers", () => {
    expect(normaliseScimPage({ startIndex: Number.NaN, count: Number.NaN })).toEqual({
      startIndex: 1,
      count: SCIM_DEFAULT_COUNT,
    })
    expect(normaliseScimPage({ count: Number.POSITIVE_INFINITY }).count).toBe(SCIM_DEFAULT_COUNT)
  })

  it("truncates a fractional index rather than passing it through", () => {
    expect(normaliseScimPage({ startIndex: 3.9, count: 10.7 })).toEqual({ startIndex: 3, count: 10 })
  })
})

describe("the list envelope reports what was returned", () => {
  it("reports itemsPerPage from the resources, not the request", () => {
    // A caller that trusted the requested count would page past the end and
    // report phantom users.
    const response = scimListResponse([{ id: "a" }, { id: "b" }], { startIndex: 1, count: 100 }, 2)
    expect(response.itemsPerPage).toBe(2)
    expect(response.totalResults).toBe(2)
    expect(response.schemas).toEqual([LIST_RESPONSE_SCHEMA])
  })

  it("reports an empty page honestly", () => {
    const response = scimListResponse([], { startIndex: 500, count: 100 }, 12)
    expect(response.itemsPerPage).toBe(0)
    expect(response.totalResults).toBe(12)
    expect(response.startIndex).toBe(500)
  })
})

describe("PATCH changes what a provisioning agent may change", () => {
  const refusedPatch = (operations: Parameters<typeof interpretScimPatch>[0], reason: PatchRefusal) => {
    const outcome = interpretScimPatch(operations)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("expected a refusal")
    expect(outcome.reason).toBe(reason)
  }

  it("accepts a deactivation", () => {
    const outcome = interpretScimPatch([{ op: "replace", path: "active", value: false }])
    if (!outcome.ok) throw new Error(outcome.detail)
    expect(outcome.changes).toEqual([{ path: "active", op: "replace", value: false }])
  })

  it("accepts the operation names case-insensitively", () => {
    expect(interpretScimPatch([{ op: "Replace", path: "active", value: true }]).ok).toBe(true)
  })

  it("strips a schema URN prefix from the path", () => {
    const outcome = interpretScimPatch([
      { op: "replace", path: "urn:ietf:params:scim:schemas:core:2.0:User:active", value: false },
    ])
    if (!outcome.ok) throw new Error(outcome.detail)
    expect(outcome.changes[0].path).toBe("active")
  })

  it("refuses to let an agent set group membership", () => {
    // GE-043-003. Accepting it would look like it did something, and doing
    // nothing quietly is worse than saying no.
    refusedPatch([{ op: "add", path: "groups", value: ["admins"] }], "IMMUTABLE_PATH")
    refusedPatch([{ op: "replace", path: "roles", value: ["director"] }], "IMMUTABLE_PATH")
    refusedPatch([{ op: "add", path: "entitlements", value: ["billing"] }], "IMMUTABLE_PATH")
    refusedPatch([{ op: "replace", path: "members", value: [] }], "IMMUTABLE_PATH")
  })

  it("refuses to let an agent rewrite the id", () => {
    // A rewritten id detaches every record that referenced it.
    refusedPatch([{ op: "replace", path: "id", value: "other" }], "IMMUTABLE_PATH")
    refusedPatch([{ op: "replace", path: "meta.version", value: "x" }], "IMMUTABLE_PATH")
  })

  it("refuses an unknown operation", () => {
    refusedPatch([{ op: "upsert", path: "active", value: true }], "UNKNOWN_OP")
  })

  it("refuses a pathless operation rather than guessing", () => {
    // SCIM allows it and agents interpret it differently; guessing wrong writes
    // the wrong field.
    refusedPatch([{ op: "replace", value: { active: false } }], "UNSUPPORTED_PATH")
  })

  it("refuses a path it does not change", () => {
    refusedPatch([{ op: "replace", path: "password", value: "hunter2" }], "UNSUPPORTED_PATH")
  })

  it("refuses an add or replace with no value", () => {
    refusedPatch([{ op: "replace", path: "active" }], "MISSING_VALUE")
  })

  it("allows remove with no value", () => {
    const outcome = interpretScimPatch([{ op: "remove", path: "displayName" }])
    if (!outcome.ok) throw new Error(outcome.detail)
    expect(outcome.changes[0].value).toBeNull()
  })

  it("validates every operation before applying any", () => {
    // A partly-applied deprovisioning is the failure that matters: `active:
    // false` applied and the rest refused leaves somebody locked out for a
    // reason nobody recorded.
    const outcome = interpretScimPatch([
      { op: "replace", path: "active", value: false },
      { op: "replace", path: "groups", value: ["admins"] },
    ])
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("IMMUTABLE_PATH")
  })
})

describe("two agents cannot silently overwrite each other", () => {
  it("accepts a matching version", () => {
    expect(checkScimVersion({ ifMatch: '"v3"', currentVersion: '"v3"', requireMatch: true }).ok).toBe(true)
  })

  it("treats a weak ETag as the same entity", () => {
    // RFC 7232 §2.3.2. Agents differ on emitting `W/`, and treating them as
    // different makes every write from one of them a 412 forever.
    expect(checkScimVersion({ ifMatch: 'W/"v3"', currentVersion: '"v3"', requireMatch: true }).ok).toBe(true)
    expect(checkScimVersion({ ifMatch: "v3", currentVersion: 'W/"v3"', requireMatch: true }).ok).toBe(true)
  })

  it("refuses a stale version", () => {
    // An HR system and an identity provider both think they own `active`.
    // Last-write-wins between them deactivates and reactivates on alternate
    // hours.
    const outcome = checkScimVersion({ ifMatch: '"v2"', currentVersion: '"v3"', requireMatch: true })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("VERSION_MISMATCH")
  })

  it("refuses a write that did not check, when checking is required", () => {
    // "I did not check" and "I checked and it is current" must never be the
    // same input.
    const outcome = checkScimVersion({ ifMatch: null, currentVersion: '"v3"', requireMatch: true })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("VERSION_REQUIRED")
  })

  it("allows an unconditional write where that is permitted", () => {
    expect(checkScimVersion({ ifMatch: null, currentVersion: '"v3"', requireMatch: false }).ok).toBe(true)
  })
})

describe("a retried create is not a second person", () => {
  const existing = [
    { id: "u1", externalId: "hr-0042", userName: "bjensen@example.test" },
    { id: "u2", externalId: null, userName: "legacy@example.test" },
  ]

  it("returns the existing record for a repeated externalId", () => {
    // Agents retry. A 409 sends a well-behaved one into an error path for
    // having done nothing wrong.
    const outcome = decideScimCreate({ externalId: "hr-0042", userName: "anything" }, existing)
    expect(outcome).toEqual({ ok: true, action: "RETURN_EXISTING", id: "u1" })
  })

  it("matches on externalId even when the userName has changed", () => {
    // userName is not stable — it changes when somebody marries.
    const outcome = decideScimCreate({ externalId: "hr-0042", userName: "bjones@example.test" }, existing)
    expect(outcome).toEqual({ ok: true, action: "RETURN_EXISTING", id: "u1" })
  })

  it("creates when the externalId is new", () => {
    expect(decideScimCreate({ externalId: "hr-0099", userName: "new@example.test" }, existing)).toEqual({
      ok: true,
      action: "CREATE",
    })
  })

  it("conflicts when a different directory sends the same userName", () => {
    // Two directories have sent two different people under one name, and
    // picking either would merge them.
    const outcome = decideScimCreate({ externalId: "other-1", userName: "bjensen@example.test" }, existing)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("CONFLICT")
  })

  it("compares userName case-insensitively", () => {
    const outcome = decideScimCreate({ externalId: "other-1", userName: "BJensen@Example.test" }, existing)
    expect(outcome.ok).toBe(false)
  })

  it("refuses a create with no userName", () => {
    const outcome = decideScimCreate({ externalId: "hr-1", userName: "" }, existing)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("NO_IDENTIFIER")
  })

  it("does not match a null externalId against another null one", () => {
    // Two records with no externalId are not the same record, and treating them
    // as one would merge every legacy account into the first.
    const outcome = decideScimCreate({ externalId: null, userName: "fresh@example.test" }, existing)
    expect(outcome).toEqual({ ok: true, action: "CREATE" })
  })
})

describe("deactivation removes access, not history", () => {
  it("suspends the membership rather than deleting it", () => {
    // An HR system deprovisioning somebody must not take their history with
    // them, and reinstatement must not mean creating a different person.
    const effect = scimActiveEffect(false)
    expect(effect.membership).toBe("SUSPEND")
    expect(effect.detail).toMatch(/not history/)
  })

  it("ends every session immediately", () => {
    // A deprovisioning that leaves a live session running has removed the
    // ability to sign in again and nothing else — the person keeps working
    // until the session expires, which is the window offboarding exists to
    // close.
    expect(scimActiveEffect(false).revokeSessions).toBe(true)
  })

  it("reinstates without revoking", () => {
    const effect = scimActiveEffect(true)
    expect(effect.membership).toBe("REINSTATE")
    expect(effect.revokeSessions).toBe(false)
  })

  it("never deletes, in either direction", () => {
    for (const active of [true, false]) {
      expect(["SUSPEND", "REINSTATE"]).toContain(scimActiveEffect(active).membership)
    }
  })
})
