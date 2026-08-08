import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { executeStep, type ExecutionContext, type TenantManifest } from "@tenure/provisioning"

import type { AwsGateway } from "./aws/read"
import { resolveSecretRefs, secretsAreReachable, unresolvedSecretRefs } from "./secret-refs"

/**
 * STUDIO-040-005 — a secret reference is checked against the store, not against
 * a regex.
 *
 * The stand-in below behaves like the real API in the two ways that decide the
 * outcome: it throws `ResourceNotFoundException` for a secret that is not there
 * and `AccessDeniedException` when the role may not look, with the SDK's own
 * `name` field — which is what `isDenial` classifies on. A stand-in returning
 * `null` for both would collapse the two cases this whole item exists to keep
 * apart.
 */

const REAL_SECRET = {
  ARN: "arn:aws:secretsmanager:us-east-1:1:secret:tenure/prod/stripe-AbCdEf",
  LastChangedDate: new Date("2026-06-01T09:30:00.000Z"),
  RotationEnabled: true,
}

function gateway(
  answers: Record<string, "present" | "missing" | "denied" | "throttled">,
): AwsGateway {
  return {
    async call(capability, input) {
      if (capability === "secretsmanager:DescribeSecret") {
        const id = String((input ?? {}).SecretId)
        switch (answers[id]) {
          case "present":
            return REAL_SECRET
          case "denied": {
            const e = new Error(
              "User: arn:aws:sts::1:assumed-role/studio-task is not authorized to perform: secretsmanager:DescribeSecret",
            )
            e.name = "AccessDeniedException"
            throw e
          }
          case "throttled": {
            const e = new Error("Rate exceeded")
            e.name = "ThrottlingException"
            throw e
          }
          default: {
            const e = new Error(`Secrets Manager can't find the specified secret.`)
            e.name = "ResourceNotFoundException"
            throw e
          }
        }
      }
      if (capability === "ssm:DescribeParameters") {
        const names = ((input ?? {}).Names as string[]) ?? []
        const found = names.filter((n) => answers[n] === "present")
        return {
          Parameters: found.map((Name) => ({
            Name,
            LastModifiedDate: new Date("2026-05-05T00:00:00.000Z"),
          })),
        }
      }
      throw new Error(`unexpected ${capability}`)
    },
    async resolvedRegion() {
      return "us-east-1"
    },
  }
}

describe("resolving a secret reference establishes existence and nothing else", () => {
  it("reports a real secret as PRESENT, with its metadata", async () => {
    const resolved = await resolveSecretRefs(
      { stripe: "secretsmanager:tenure/prod/stripe" },
      gateway({ "tenure/prod/stripe": "present" }),
    )
    expect(resolved.stripe).toEqual({
      state: "PRESENT",
      lastChanged: "2026-06-01T09:30:00.000Z",
      rotationEnabled: true,
    })
    // And nothing that looks like a value came back with it.
    expect(JSON.stringify(resolved)).not.toMatch(/SecretString|secretValue/i)
  })

  it("reports a reference to nothing as MISSING", async () => {
    const resolved = await resolveSecretRefs(
      { ghost: "secretsmanager:tenure/foo/does-not-exist" },
      gateway({}),
    )
    expect(resolved.ghost).toEqual({ state: "MISSING" })
  })

  it("reports a refusal as UNKNOWN, with the action and the statement that would fix it", async () => {
    const resolved = await resolveSecretRefs(
      { locked: "secretsmanager:tenure/prod/locked" },
      gateway({ "tenure/prod/locked": "denied" }),
    )
    expect(resolved.locked).toMatchObject({
      state: "UNKNOWN",
      action: "secretsmanager:DescribeSecret",
    })
    if (resolved.locked.state !== "UNKNOWN") return
    expect(resolved.locked.minimumStatement).toMatch(/secretsmanager:DescribeSecret/)
    expect(resolved.locked.minimumStatement).toMatch(/"Effect":"Allow"/)
  })

  it("does not report a throttle as a missing secret", async () => {
    // A throttle means the engine did not learn whether the secret exists.
    // Reporting MISSING would fail a provisioning run over a rate limit, and
    // reporting PRESENT would pass one on nothing at all.
    const resolved = await resolveSecretRefs(
      { busy: "secretsmanager:tenure/prod/busy" },
      gateway({ "tenure/prod/busy": "throttled" }),
    )
    expect(resolved.busy.state).toBe("UNKNOWN")
    if (resolved.busy.state !== "UNKNOWN") return
    expect(resolved.busy.minimumStatement).toMatch(/ThrottlingException/)
  })

  it("resolves Parameter Store references through DescribeParameters", async () => {
    const resolved = await resolveSecretRefs(
      { flag: "ssm:/tenure/prod/flag", gone: "ssm:/tenure/prod/gone" },
      gateway({ "/tenure/prod/flag": "present" }),
    )
    expect(resolved.flag).toEqual({
      state: "PRESENT",
      lastChanged: "2026-05-05T00:00:00.000Z",
      rotationEnabled: false,
    })
    expect(resolved.gone).toEqual({ state: "MISSING" })
  })

  it("says UNKNOWN, never PRESENT, when no region is resolved", () => {
    expect(secretsAreReachable({})).toBe(false)
    expect(secretsAreReachable({ AWS_REGION: "us-east-1" })).toBe(true)
    const resolved = unresolvedSecretRefs({ a: "secretsmanager:x" }, "nothing was checked")
    expect(resolved.a.state).toBe("UNKNOWN")
  })
})

/* ------------------------------------------------------------------------- */

const manifest = (secretRefs: Record<string, string>): TenantManifest => ({
  manifestVersion: 1,
  slug: "simon-ose",
  legalName: "Simon Business School",
  displayName: "Simon OSE",
  blueprintId: "university-student-organizations",
  modules: ["governance"],
  entitlements: [],
  region: "us-east-1",
  isolation: "pooled",
  coexistence: "TENURE_CLOUD_PRIMARY",
  systemOfRecord: { org: "tenure" },
  configuration: {},
  secretRefs,
  initialAdminEmail: "admin@simon.example",
})

const contextWith = (
  resolved: Awaited<ReturnType<typeof resolveSecretRefs>>,
): ExecutionContext => ({
  resolveConfiguration: () => ({ checksum: "cfg-abc123", values: { a: 1 }, problems: [] }),
  resolveModules: () => ({ ordered: [{ key: "governance", version: "1.2.0" }], problems: [] }),
  validateTopology: () => ({ valid: true, problems: [] }),
  schemaVersion: () => "2026.07.31",
  resolveSecretRefs: () => resolved,
})

const verify = async (
  refs: Record<string, string>,
  answers: Record<string, "present" | "missing" | "denied" | "throttled">,
) => {
  const resolved = await resolveSecretRefs(refs, gateway(answers))
  return executeStep("VERIFYING", manifest(refs), contextWith(resolved), {
    correlationId: "secret-ref-test",
    attempt: 1,
    awsRequestIds: [],
    assumedRoleArn: null,
    resourceHandles: [],
    nextRetryAt: null,
    compensation: null,
  })
}

describe("VERIFYING reaches three different outcomes, not one regex", () => {
  const check = (evidence: { checks?: ReadonlyArray<{ name: string; ok: boolean; detail: string }> }, name: string) =>
    evidence.checks!.find((c) => c.name === name)!

  it("passes when every reference exists", async () => {
    const evidence = await verify(
      { stripe: "secretsmanager:tenure/prod/stripe" },
      { "tenure/prod/stripe": "present" },
    )
    expect(evidence.ok).toBe(true)
    expect(check(evidence, "every secret reference exists").ok).toBe(true)
    expect(check(evidence, "every secret reference was checkable").ok).toBe(true)
  })

  it("FAILS the step when a reference names nothing — the case the regex passed", async () => {
    // `secretsmanager:tenure/foo/does-not-exist` matches
    // /^(secretsmanager|ssm):/ perfectly. Under the old check this reached
    // ACTIVATING and failed inside the cell, after the tenant existed.
    const evidence = await verify({ ghost: "secretsmanager:tenure/foo/does-not-exist" }, {})
    expect(evidence.ok).toBe(false)
    const existence = check(evidence, "every secret reference exists")
    expect(existence.ok).toBe(false)
    expect(existence.detail).toMatch(/Named and not found: ghost/)
    expect(existence.detail).toMatch(/would have failed inside the cell/)
    // And it is NOT reported as unreadable: those are different remedies.
    expect(check(evidence, "every secret reference was checkable").ok).toBe(true)
  })

  it("reports a denial as unknown rather than as a pass OR as missing", async () => {
    const evidence = await verify(
      { locked: "secretsmanager:tenure/prod/locked" },
      { "tenure/prod/locked": "denied" },
    )
    expect(evidence.ok).toBe(false)
    // Existence is not claimed either way.
    expect(check(evidence, "every secret reference exists").ok).toBe(true)
    const checkable = check(evidence, "every secret reference was checkable")
    expect(checkable.ok).toBe(false)
    expect(checkable.detail).toMatch(/UNKNOWN, not a pass/)
    expect(checkable.detail).toMatch(/secretsmanager:DescribeSecret/)
  })

  it("says so plainly when a manifest declares no references at all", async () => {
    const evidence = await verify({}, {})
    expect(evidence.ok).toBe(true)
    expect(check(evidence, "every secret reference exists").detail).toMatch(
      /No secret references are declared/,
    )
  })

  it("changes the verification digest, so the artifact cannot cite a run that says nothing", async () => {
    const good = await verify(
      { stripe: "secretsmanager:tenure/prod/stripe" },
      { "tenure/prod/stripe": "present" },
    )
    const bad = await verify({ stripe: "secretsmanager:tenure/prod/stripe" }, {})
    expect(good.digest).not.toBe(bad.digest)
  })
})

/**
 * Comments removed, string literals kept.
 *
 * Strings must survive: `new GetSecretValueCommand` is code, and so is a
 * capability named `"secretsmanager:GetSecretValue"` in a table — both are ways
 * the ability could arrive. Only prose is dropped.
 */
function stripComments(text: string): string {
  let out = ""
  let state: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code"
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const d = text[i + 1]
    if (state === "code") {
      if (c === "/" && d === "/") {
        state = "line"
        i += 2
        continue
      }
      if (c === "/" && d === "*") {
        state = "block"
        i += 2
        continue
      }
      if (c === "'") state = "sq"
      else if (c === '"') state = "dq"
      else if (c === "`") state = "tpl"
      out += c
      i += 1
      continue
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code"
        out += c
      }
      i += 1
      continue
    }
    if (state === "block") {
      if (c === "*" && d === "/") {
        state = "code"
        i += 2
        continue
      }
      if (c === "\n") out += c
      i += 1
      continue
    }
    if (c === "\\") {
      out += c + (d ?? "")
      i += 2
      continue
    }
    if (c === "\n" && state !== "tpl") {
      state = "code"
      out += c
      i += 1
      continue
    }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) {
      state = "code"
    }
    out += c
    i += 1
  }
  return out
}

describe("the console cannot read a secret value, and cannot grow the ability to", () => {
  it("never mentions GetSecretValue anywhere under apps/system-studio/src", () => {
    // A guard rather than a convention. The whole safety argument for letting
    // this control plane touch Secrets Manager at all is that the only calls it
    // can make are metadata calls, and a convention is not an argument.
    const root = path.resolve(__dirname, "..")
    const files = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", root],
      { encoding: "utf8", cwd: path.resolve(root, "..", "..", "..") },
    )
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f))

    expect(files.length).toBeGreaterThan(20)

    const offenders: string[] = []
    for (const file of files) {
      const abs = path.resolve(root, "..", "..", "..", file)
      let text: string
      try {
        text = fs.readFileSync(abs, "utf8")
      } catch {
        continue
      }
      // Comments are stripped first. Three modules NAME these calls in order to
      // say they are forbidden — `capabilities.ts` explains why they are not in
      // the capability table, `client.ts` says the command class is not
      // imported, and `secret-refs.ts` states the rule the module is built
      // around. A guard that reds on the sentence forbidding the thing is a
      // guard that gets the sentence deleted, which is the opposite of what it
      // wants. The CODE is what must not contain them.
      if (abs === __filename) continue
      if (/GetSecretValue|GetParameterCommand|WithDecryption/.test(stripComments(text))) {
        offenders.push(file)
      }
    }

    expect(offenders).toEqual([])
  })
})
