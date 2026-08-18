import type { PublicationPlan } from "@tenure/configuration"

/**
 * CFG-020-004 / CFG-030-003 — what the compiled graph says about this change,
 * for the operator about to sign it.
 *
 * `planPublication` compiles the configuration graph, evaluates it over the
 * proposal (incrementally, from an evaluation of the current configuration) and
 * projects the client-safe half of the same snapshot. All three were being
 * computed and then discarded: the review panel showed a diff of KEYS, and the
 * consequences of those keys — which fields stop applying, which stop being
 * editable, what an approval would be bound to — were in the plan and on no
 * screen.
 *
 * This turns them into lines. It is a presenter and nothing more: no decision is
 * taken here, and every line either states a fact from the plan or states that
 * the fact is missing and why. The distinction matters more than the formatting.
 * "No field moves" and "nothing was evaluated" render identically if you let
 * them, and they are opposite answers — one is a safe change, the other is a
 * change nobody has looked at.
 */
export interface ConsequenceLine {
  /** Stable key for React and for tests. */
  id: string
  label: string
  detail: string
}

const list = (values: readonly string[]): string => values.join(", ")

export function consequenceLines(plan: PublicationPlan): readonly ConsequenceLine[] {
  const lines: ConsequenceLine[] = []

  if (!plan.graph) {
    return [
      {
        id: "graph",
        label: "Graph",
        detail:
          "This plan carries no compiled graph. Nothing here can be said about which fields the change " +
          "reaches, and the absence is the finding.",
      },
    ]
  }

  if (!plan.evaluation) {
    lines.push({
      id: "not-evaluated",
      label: "Not evaluated",
      detail:
        plan.evaluationSkipped ??
        "The plan carries no evaluation and no reason for its absence, which is itself a defect worth reporting.",
    })
    return lines
  }

  const affected = plan.nodesAffected ?? []
  lines.push({
    id: "fields-moved",
    label: "Fields this moves",
    detail:
      affected.length === 0
        ? "None. No field's value or evaluated state changes — the graph was evaluated and found nothing moved."
        : list([...affected]),
  })

  lines.push({
    id: "bound-to",
    label: "Bound to",
    detail:
      `${plan.evaluation.outputDigest} over graph ${plan.evaluation.graphDigest}. An approval binds to this ` +
      `pair, so a proposal edited after approval no longer matches it.`,
  })

  if (plan.evaluation.errors.length > 0) {
    lines.push({
      id: "rule-errors",
      label: "Rules that did not evaluate",
      detail:
        `${list([...plan.evaluation.errors])} — a rule that failed did NOT decide anything. The fields it ` +
        `governs are shown in their default state, which is not the same as being checked.`,
    })
  }

  if (plan.presentation) {
    const withheld = plan.presentation.withheld
    lines.push({
      id: "withheld",
      label: "Withheld from the browser",
      detail:
        withheld.length === 0
          ? "None. Every field in this graph is safe to render, and its presentation rules travel with it."
          : withheld.map((w) => `${w.id} (${w.reason})`).join("; "),
    })
  }

  const unrepresentable = plan.unrepresentableKeys ?? []
  if (unrepresentable.length > 0) {
    lines.push({
      id: "no-node",
      label: "Configured, and outside the graph",
      // Each key with ITS OWN reason. One reason printed against a list of keys
      // is a claim about keys nobody checked — the failure this whole panel is
      // supposed to make impossible.
      detail:
        `${unrepresentable.map((u) => `${u.key}: ${u.reason}`).join(" ")} These keys are published and ` +
        `resolved as normal; what they do not have is an evaluated state, so nothing above is a ` +
        `statement about them.`,
    })
  }

  return lines
}
