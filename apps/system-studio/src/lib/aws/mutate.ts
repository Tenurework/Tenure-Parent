import type { IsolationTier, TenantState } from "@tenure/provisioning"

/**
 * STUDIO-140-006 — the gate every Studio-originated AWS mutation passes through,
 * and the arm that refuses the destructive half outright.
 *
 * ## Why this module holds no client
 *
 * It imports nothing from `@aws-sdk/*`, and that is enforced rather than
 * intended: `tests/architecture/forbidden-clients.test.mjs` names
 * `apps/system-studio/src/lib/registry.ts` as the ONLY module in this app
 * permitted to import the SDK, and its AWS exemption list is asserted to be
 * empty. So the refusal below cannot be quietly softened into "refuse, then do
 * it anyway" — there is no reachable code path from here to an API call.
 *
 * ## Why the destructive verbs are refused rather than gated
 *
 * A terminate, a delete, a revoke and a scale-to-zero against something that is
 * currently serving have one property in common: trying again does not undo
 * them. Every other control in this console — the lifecycle graph, the second
 * approver, the typed target — reduces the chance of the wrong call being made.
 * None of them recovers from it. `canReachServing` in `lib/tenant-state.ts` is
 * the model: it does not label a move irreversible, it walks the graph and finds
 * that no serving state is reachable, and the answer is a fact about the
 * machine rather than a note somebody wrote.
 *
 * So this returns the command instead. A human running
 * `aws dynamodb batch-write-item` from their own session does the same damage —
 * but they do it under their own credentials, with their own eyes on the
 * resource name, and no automated retry can do it twice.
 *
 * ## What it is not
 *
 * It is not a permission system (`lib/operators.ts` and `lib/authorize.ts` are)
 * and it is not an approval workflow (the lifecycle engine is). It answers one
 * question — may this console perform this mutation itself — and it answers it
 * the same way for every caller.
 */

/** The closed vocabulary of things a control plane does to a resource. */
export type MutationVerb =
  // Reversible by doing the opposite, or by leaving it alone.
  | "create"
  | "update"
  | "tag"
  // Not reversible by trying again.
  | "terminate"
  | "delete"
  | "revoke"
  | "scale-to-zero"

/**
 * The four the Bible's high-risk list names.
 *
 * `scale-to-zero` is conditional and the other three are not: taking an idle
 * task to zero is a cost decision, and taking a serving one to zero is an
 * outage. That distinction is made in `planMutation`, from `serving`, rather
 * than by having two verbs — a caller choosing between `scale-to-zero` and
 * `scale-to-zero-but-it-is-serving` is a caller deciding its own gate.
 */
export const DESTRUCTIVE_VERBS: ReadonlySet<MutationVerb> = new Set<MutationVerb>([
  "terminate",
  "delete",
  "revoke",
  "scale-to-zero",
])

export interface MutationRequest {
  verb: MutationVerb
  /**
   * The exact resource. An ARN where one exists; otherwise `service:name`, which
   * is what a DynamoDB partition has instead.
   *
   * This is also the string an operator has to type into the confirmation for an
   * AWS mutation, which is why it must be exact rather than descriptive.
   */
  resource: string
  /** Whether the resource is answering requests right now. */
  serving: boolean
  /** Why it is being asked for. Recorded on the audit row, in the operator's words. */
  reason: string
  /**
   * What a human runs instead, verbatim.
   *
   * Required, and refusing without one is treated as a programming error rather
   * than an operator error: a refusal that cannot say what to do instead is a
   * dead end, and the operator's next move is to find someone with wider
   * credentials — which is the outcome this gate exists to avoid.
   */
  runYourself: readonly string[]
}

export type MutationVerdict =
  | {
      outcome: "REFUSED_IRREVERSIBLE"
      message: string
      /** The commands, so a surface can render them without re-deriving anything. */
      runYourself: readonly string[]
    }
  | { outcome: "PERMITTED"; message: string }

/**
 * May this console perform the mutation itself?
 *
 * Pure, synchronous and total: there is no path through it that reaches a
 * network, which is the property that makes "NEVER calls the SDK" checkable
 * rather than promised.
 */
export function planMutation(request: MutationRequest): MutationVerdict {
  const destructive =
    DESTRUCTIVE_VERBS.has(request.verb) &&
    // Scaling something to zero that is not serving anything is a cost change,
    // not an outage — and refusing it would make the console unable to do the
    // one cheap, safe thing it is for.
    (request.verb !== "scale-to-zero" || request.serving)

  if (!destructive) {
    return {
      outcome: "PERMITTED",
      message: `${request.verb} on ${request.resource} is reversible by doing the opposite.`,
    }
  }

  if (request.runYourself.length === 0) {
    // Not a refusal an operator can be shown, because it is not about them.
    throw new Error(
      `planMutation was asked to refuse ${request.verb} on ${request.resource} without a command a ` +
        `human could run instead. A refusal with no remedy sends an operator looking for wider ` +
        `credentials, which is the outcome this gate exists to prevent.`,
    )
  }

  return {
    outcome: "REFUSED_IRREVERSIBLE",
    message:
      `REFUSED_IRREVERSIBLE — this console does not ${request.verb} ${request.resource}. ` +
      (request.verb === "scale-to-zero"
        ? `That resource is serving traffic, so taking it to zero is an outage, not a saving. `
        : `Trying again does not undo it, and no approval in this console recovers from it. `) +
      `Run it yourself, under your own credentials: ${request.runYourself.join(" ; ")}`,
    runYourself: request.runYourself,
  }
}

/**
 * The AWS mutation a lifecycle move actually performs, or `null` when it
 * performs none.
 *
 * Two moves in this platform touch AWS at all, and both are in the destructive
 * half:
 *
 *   * `PURGING` deletes the tenant's registry partition. The Studio holds the
 *     only DynamoDB client in the app, so it is the only thing that COULD, and
 *     the item that says purging "cannot be undone" is describing this call.
 *   * `HIBERNATING` a tenant that is not pooled and is currently serving means
 *     taking its own compute to zero. `executeStep` does not do that today — it
 *     returns "No engine-side work is defined for this state" — so moving the
 *     row without stopping anything publishes a `HIBERNATED_ZERO_RUNTIME` claim
 *     the estate does not satisfy, which is precisely the lie GE-103-012 exists
 *     to stop. Refusing with the command is the honest arm.
 *
 * A pooled tenant has no compute of its own, so hibernating one is not a
 * mutation and returns `null` rather than a permitted verdict — "nothing to do"
 * and "allowed to do it" are different answers.
 */
export function mutationForTransition(input: {
  slug: string
  to: TenantState
  isolation: IsolationTier
  /** Whether the published artifact routes traffic at this tenant right now. */
  serving: boolean
  /** The registry table, so the command names the real resource. */
  tenantTable: string | undefined
  reason: string
}): MutationRequest | null {
  const table = input.tenantTable ?? "<TENANT_TABLE>"

  if (input.to === "PURGING") {
    return {
      verb: "delete",
      resource: `dynamodb:${table}/TENANT#${input.slug}`,
      serving: input.serving,
      reason: input.reason,
      runYourself: [
        `aws dynamodb query --table-name ${table} ` +
          `--key-condition-expression "pk = :pk" ` +
          `--expression-attribute-values '{":pk":{"S":"TENANT#${input.slug}"}}' ` +
          `--projection-expression "pk,sk"`,
        `aws dynamodb batch-write-item --request-items ` +
          `'{"${table}":[{"DeleteRequest":{"Key":{"pk":{"S":"TENANT#${input.slug}"},"sk":{"S":"<each sk above>"}}}}]}'`,
        `# the tenant's own rows live in the cell's database, which this console ` +
          `never writes to (see packages/provisioning/src/execute.ts) — ask the cell to purge them`,
      ],
    }
  }

  if (input.to === "HIBERNATING" && input.isolation !== "pooled" && input.serving) {
    return {
      verb: "scale-to-zero",
      resource: `ecs:service/${input.slug}`,
      serving: true,
      reason: input.reason,
      runYourself: [
        `aws ecs update-service --cluster <the cell's cluster> --service ${input.slug} --desired-count 0`,
        `# then move the tenant to HIBERNATING once its own compute is actually at zero`,
      ],
    }
  }

  return null
}
