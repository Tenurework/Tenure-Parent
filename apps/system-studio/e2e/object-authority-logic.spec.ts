import { test, expect } from "@playwright/test"

import { coexistenceProblems } from "@tenure/provisioning"

import { parseObjectAuthority } from "../src/lib/object-authority"

/**
 * WRK-020-004 — the line grammar the compose form documents.
 *
 * No browser: this is a property of the parser and of what it hands to the
 * validator. `states-logic.spec.ts` is the same shape and for the same reason.
 *
 * The last case is the one that matters most. It puts the parser's output
 * through `coexistenceProblems` — the function `validateManifest` calls — so
 * this file cannot pass while the two disagree about what a declaration is.
 */

test.describe("an operator types object authority; the server reads it", () => {
  test("reads an object and the fields that differ from it", () => {
    const { entries, problems } = parseObjectAuthority(
      [
        "# the customer's ERP owns the money",
        "finance.Invoice external INBOUND",
        "finance.Invoice.internalNote tenure",
        "",
        "finance.Budget external NONE",
      ].join("\n"),
    )

    expect(problems).toEqual([])
    expect(entries).toEqual([
      {
        domain: "finance",
        object: "Invoice",
        authority: "external",
        direction: "INBOUND",
        fields: [{ field: "internalNote", authority: "tenure" }],
      },
      { domain: "finance", object: "Budget", authority: "external", direction: "NONE" },
    ])
  })

  test("an empty box is a complete declaration, not an empty one", () => {
    // Every tenant composed here today. Domain-grain authority is a whole
    // answer, and the parser must not turn "nothing typed" into a problem.
    expect(parseObjectAuthority("")).toEqual({ entries: [], problems: [] })
    expect(parseObjectAuthority("   \n\n  ").entries).toEqual([])
  })

  test("refuses an object line with no sync direction", () => {
    const { problems } = parseObjectAuthority("finance.Invoice external")
    expect(problems.map((p) => p.reason)).toEqual(["malformed-object-line"])
    expect(problems[0].detail).toContain("line 1")
  })

  test("refuses a field before the object it refines", () => {
    // The field's owner is only meaningful against the object's own owner, so
    // a field line with nothing above it cannot be checked at all.
    const { problems } = parseObjectAuthority("finance.Invoice.internalNote tenure")
    expect(problems.map((p) => p.reason)).toEqual(["field-without-object"])
  })

  test("refuses a line that is neither", () => {
    const { problems } = parseObjectAuthority("finance external INBOUND")
    expect(problems.map((p) => p.reason)).toEqual(["malformed-line"])
  })

  test("does not drop a line it could not read", () => {
    // Silently ignoring it would register a tenant whose coexistence contract
    // is quietly shorter than what the operator wrote.
    const { entries, problems } = parseObjectAuthority(
      ["finance.Invoice external INBOUND", "nonsense"].join("\n"),
    )
    expect(entries).toHaveLength(1)
    expect(problems).toHaveLength(1)
  })

  test("leaves the vocabulary to the one place that owns it", () => {
    // `external`/`INBOUND` are not checked here on purpose — a second copy of
    // the vocabulary is a second answer. The parser passes the words through
    // and `coexistenceProblems` refuses them, which is what the manifest
    // validator will do with the same input.
    const { entries, problems } = parseObjectAuthority("finance.Invoice sideways UPSTREAM")
    expect(problems).toEqual([])

    const refused = coexistenceProblems({
      profile: "HYBRID_PROCESS_SPLIT",
      systemOfRecord: { finance: "external" },
      objectAuthority: entries,
    })
    // Two problems, not three: "sideways" is refused as an authority and NOT
    // also reported as contradicting the domain. A word that is not an
    // authority cannot disagree with one, and saying it twice would send an
    // operator to fix the domain map over a typo in the object line.
    expect(refused.map((p) => p.reason).sort()).toEqual([
      "unknown-authority",
      "unknown-direction",
    ])
  })

  test("hands the validator something it accepts when the lines are coherent", () => {
    const { entries } = parseObjectAuthority(
      ["finance.Invoice external INBOUND", "finance.Invoice.internalNote tenure"].join("\n"),
    )
    expect(
      coexistenceProblems({
        profile: "HYBRID_PROCESS_SPLIT",
        systemOfRecord: { finance: "external", org: "tenure" },
        objectAuthority: entries,
      }),
    ).toEqual([])
  })
})
