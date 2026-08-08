import type { SecretRefResolution } from "@tenure/provisioning"

import { minimumStatementText } from "./aws/capabilities"
import { isDenial, liveGateway, type AwsGateway } from "./aws/read"

/**
 * STUDIO-040-005 — does the secret a manifest names actually exist?
 *
 * The first half of this requirement was already done and is not repeated here:
 * `SECRET_REF_SHAPE` (packages/provisioning/src/manifest.ts:159) refuses a
 * credential-shaped VALUE in a manifest and insists the author move it into
 * `secretRefs` as a `secretsmanager:` or `ssm:` reference.
 *
 * The second half — "validate existence and access without exposing the value"
 * — did not exist at all. The VERIFYING check that claimed to do it was
 * `Object.values(manifest.secretRefs).every(r => /^(secretsmanager|ssm):/.test(r))`:
 * a regex over a string, which passes `secretsmanager:tenure/foo/does-not-exist`
 * exactly as happily as a reference to something real. The failure then happened
 * at ACTIVATING, inside the cell, after the tenant had been created.
 *
 * ── The rule this module is built around ───────────────────────────────────
 *
 * **Two API calls, and neither can return a secret value.**
 *
 *   `secretsmanager:DescribeSecret`  metadata: existence, last-changed,
 *                                    rotation. No `SecretString` field exists
 *                                    on the response.
 *   `ssm:DescribeParameters`         metadata for a named parameter. The
 *                                    response shape has no `Value`.
 *
 * `GetSecretValue` and `GetParameter --with-decryption` are the calls that WOULD
 * expose a value, and they are absent from this file, from `aws/client.ts` and
 * from the capability table. `secret-refs.test.ts` asserts the string
 * `GetSecretValue` appears nowhere under `apps/system-studio/src`, so adding one
 * later is a red test rather than a code review somebody has to catch.
 *
 * The reason is not squeamishness. This console renders every tenant's
 * configuration; a console that can also read every tenant's credentials is one
 * compromised session away from being the worst thing in the estate.
 *
 * ── Three outcomes, and the third is the one that matters ──────────────────
 *
 * PRESENT / MISSING / UNKNOWN. `UNKNOWN` is what a denial produces, and it is
 * never rounded to either of the others: telling an operator "the secret is
 * missing" when the truth is "this engine may not look" sends them to delete and
 * recreate a secret that was fine, and telling them it is present would let a
 * provisioning run proceed on an assumption.
 */

/** `secretsmanager:tenure/prod/stripe` or `ssm:/tenure/prod/flag`. */
function splitRef(ref: string): { store: "secretsmanager" | "ssm"; id: string } | null {
  const at = ref.indexOf(":")
  if (at < 0) return null
  const store = ref.slice(0, at)
  const id = ref.slice(at + 1)
  if (!id) return null
  if (store === "secretsmanager" || store === "ssm") return { store, id }
  return null
}

/** The shape `DescribeSecret` answers with. Narrowed; nothing else is read. */
interface DescribeSecretResponse {
  ARN?: string
  LastChangedDate?: Date | string
  RotationEnabled?: boolean
}

/** The shape `DescribeParameters` answers with. */
interface DescribeParametersResponse {
  Parameters?: Array<{ Name?: string; LastModifiedDate?: Date | string }>
}

function asIso(value: Date | string | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Resolve every reference a manifest declares.
 *
 * Sequential rather than parallel: the whole map is at most a handful of
 * entries, and a burst of DescribeSecret calls is the fastest way to be
 * throttled by a service whose quota is shared with everything else in the
 * account.
 *
 * Never throws. A resolver that throws would take down a provisioning run for
 * the same reason it should have failed a check, and the check is where an
 * operator can read what happened.
 */
export async function resolveSecretRefs(
  refs: Readonly<Record<string, string>>,
  gateway: AwsGateway = liveGateway(),
): Promise<Readonly<Record<string, SecretRefResolution>>> {
  const out: Record<string, SecretRefResolution> = {}

  for (const [name, ref] of Object.entries(refs)) {
    const parsed = splitRef(ref)
    if (!parsed) {
      // Shape is the OTHER half of this requirement and it is enforced by
      // `validateManifest`, so a reference that does not parse here is one that
      // reached the registry before that check existed. MISSING is the honest
      // answer: there is nothing this could name.
      out[name] = { state: "MISSING" }
      continue
    }

    try {
      if (parsed.store === "secretsmanager") {
        const described = (await gateway.call("secretsmanager:DescribeSecret", {
          SecretId: parsed.id,
        })) as DescribeSecretResponse
        out[name] = {
          state: "PRESENT",
          lastChanged: asIso(described?.LastChangedDate),
          rotationEnabled: described?.RotationEnabled === true,
        }
      } else {
        const described = (await gateway.call("ssm:DescribeParameters", {
          Names: [parsed.id],
        })) as DescribeParametersResponse
        const found = (described?.Parameters ?? []).find((p) => p.Name === parsed.id)
        out[name] = found
          ? {
              state: "PRESENT",
              lastChanged: asIso(found.LastModifiedDate),
              // Parameter Store has no rotation of its own. Reported as false
              // rather than omitted: "not rotating" is the true answer and the
              // one a posture review needs.
              rotationEnabled: false,
            }
          : { state: "MISSING" }
      }
    } catch (error) {
      // ResourceNotFoundException is the definite answer "there is nothing
      // here", and it is the whole reason this check is worth making. Anything
      // that looks like a denial is UNKNOWN. Anything else — a throttle, a
      // network failure — is also UNKNOWN, because the engine did not learn
      // whether the secret exists and inventing either answer is worse than
      // saying so.
      if (errorNameOf(error) === "ResourceNotFoundException") {
        out[name] = { state: "MISSING" }
        continue
      }
      const capability = parsed.store === "secretsmanager"
        ? ("secretsmanager:DescribeSecret" as const)
        : ("ssm:DescribeParameters" as const)
      out[name] = {
        state: "UNKNOWN",
        action: capability,
        minimumStatement: isDenial(error)
          ? minimumStatementText(capability)
          : `${minimumStatementText(capability)} (the call failed with ${errorNameOf(error)}, which is not a denial — ` +
            `check the endpoint before widening the policy)`,
      }
    }
  }

  return out
}

function errorNameOf(error: unknown): string {
  const e = error as { name?: unknown; __type?: unknown } | null
  if (!e) return "UnknownError"
  for (const candidate of [e.name, e.__type]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.includes("#") ? candidate.slice(candidate.lastIndexOf("#") + 1) : candidate
    }
  }
  return "UnknownError"
}

/**
 * The answer when no AWS region is resolved for this process.
 *
 * Every reference comes back UNKNOWN, which is exactly right: nothing was
 * checked. Returning PRESENT would make a local run pass a check a deployed one
 * would fail, and returning MISSING would make it impossible to advance a
 * tenant anywhere without AWS.
 */
export function unresolvedSecretRefs(
  refs: Readonly<Record<string, string>>,
  why: string,
): Readonly<Record<string, SecretRefResolution>> {
  return Object.fromEntries(
    Object.keys(refs).map((name) => [
      name,
      {
        state: "UNKNOWN" as const,
        action: "secretsmanager:DescribeSecret",
        minimumStatement: why,
      },
    ]),
  )
}

/** Whether a secret lookup can be attempted at all. */
export function secretsAreReachable(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim())
}
