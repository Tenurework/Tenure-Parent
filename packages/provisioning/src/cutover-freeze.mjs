/**
 * EXT-100-005 — freeze and coexistence classification, and the dual-write refusal.
 *
 * `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md` §12.5
 * opens with four words that are the whole requirement: "Every object/process is
 * classified." It then names the five classes and ends with the sentence this
 * module exists to hold:
 *
 *   "Dual writes are prohibited unless conflict semantics, reconciliation,
 *    ownership, loop prevention, failure recovery, and sunset are proven."
 *
 * Before this file, `grep -rin "hard freeze" apps packages tools tests` found
 * nothing. `packages/module-runtime/src/coexistence.ts` decides who *owns* a
 * domain over a tenant's whole life; a cutover freeze decides who may *touch* an
 * object during the hours either side of T0, and those are different questions
 * about different time scales. This module therefore reuses that file's
 * vocabulary — `SystemOfRecordAuthority`, `SyncDirection` — rather than
 * inventing a second one, because two lists that can disagree eventually do.
 *
 * ── Why JavaScript in a TypeScript package ─────────────────────────────────
 *
 * Same reason as `connection-cardinality.mjs`, and stated there at length: two
 * readers must load it on Node 20 (which CI pins) — `node --test` through
 * `tools/run-platform-tests.mjs`, and the generator that writes
 * `docs/architecture/cutover-command-center.md`. Neither can load TypeScript on
 * 20. The package's `main`/`exports` stay TypeScript-only, so
 * `@tenure/provisioning`'s public surface is unchanged.
 *
 * ── Default deny, and why the shape enforces it ────────────────────────────
 *
 * `dualWriteVerdict` returns `{ allowed: false }` for an object that says
 * nothing about dual writes, for one that declares them under the wrong class,
 * and for one that declares them with four of the six proofs. Only the complete
 * declaration returns `allowed: true`. An absent field is never read as
 * permission, because a plan that forgot to mention a second writer and a plan
 * that has none look identical from the outside — and only one of them is safe.
 *
 * ── Refused is not the same as unclassified ────────────────────────────────
 *
 * Every problem carries a `reason` code, and the two codes an operator most
 * needs to tell apart are `unclassified` (nobody decided what this object's
 * freeze is) and the class-specific refusals (somebody decided, and the decision
 * contradicts itself). The first says nobody looked. The second says we looked
 * and it does not hold. Collapsing them is the bug this codebase's central rule
 * exists to catch.
 */

/** §12.5's five classes, in the document's order. */
export const FREEZE_CLASSES = Object.freeze([
  /** No source change after cutoff. */
  "HARD_FREEZE",
  /** Changes permitted only through approved exception and delta capture. */
  "SOFT_FREEZE",
  /** Legacy remains query-only. */
  "READ_ONLY_COEXISTENCE",
  /** Both sides operate. Allowed only with the six proofs below. */
  "DUAL_OPERATION",
  /** Data/process remains legacy with governed link and retirement plan. */
  "DEFERRED_MIGRATION",
])

/**
 * What §12.5 requires of a `DUAL_OPERATION` classification, verbatim from the
 * bullet: "explicit system-of-record ownership, direction, deduplication,
 * conflict handling, duration, and exit".
 *
 * Keys rather than prose so a missing one is a name an operator can look up,
 * and so the list cannot drift from the check that reads it.
 */
export const DUAL_OPERATION_PROOFS = Object.freeze([
  Object.freeze({ key: "systemOfRecord", phrase: "explicit system-of-record ownership" }),
  Object.freeze({ key: "direction", phrase: "direction" }),
  Object.freeze({ key: "deduplication", phrase: "deduplication" }),
  Object.freeze({ key: "conflictHandling", phrase: "conflict handling" }),
  Object.freeze({ key: "duration", phrase: "duration" }),
  Object.freeze({ key: "exit", phrase: "exit" }),
])

/**
 * The six proofs §12.5's closing sentence requires before a DUAL WRITE — two
 * systems both writing the same object — is anything other than prohibited.
 *
 * A deliberately different list from `DUAL_OPERATION_PROOFS` above, because the
 * document states two different requirements: dual *operation* (both systems
 * running) needs ownership and an exit; dual *writing* (both systems writing one
 * object) additionally needs loop prevention and failure recovery, which is what
 * makes a bidirectional channel not eat itself.
 */
export const DUAL_WRITE_PROOFS = Object.freeze([
  Object.freeze({ key: "conflictSemantics", phrase: "conflict semantics" }),
  Object.freeze({ key: "reconciliation", phrase: "reconciliation" }),
  Object.freeze({ key: "ownership", phrase: "ownership" }),
  Object.freeze({ key: "loopPrevention", phrase: "loop prevention" }),
  Object.freeze({ key: "failureRecovery", phrase: "failure recovery" }),
  Object.freeze({ key: "sunset", phrase: "sunset" }),
])

/** Who may write, from `packages/module-runtime/src/coexistence.ts`. */
export const WRITE_SYSTEMS = Object.freeze(["tenure", "legacy"])

const proof = (value) => typeof value === "string" && value.trim().length > 0

const problem = (object, reason, detail) => Object.freeze({ object, reason, detail })

/**
 * Whether one object's dual-write declaration is permitted.
 *
 * Three distinguishable answers, never two:
 *
 *   `{ allowed: false, dualWrite: false }`  the object has one writer. Nothing
 *                                           to permit; not a refusal either.
 *   `{ allowed: false, missing: [...] }`    two writers, and the named proofs
 *                                           are absent. Prohibited by §12.5.
 *   `{ allowed: true }`                     two writers and all six proofs.
 *
 * `writesTo` is the input that decides, and it is read rather than inferred: an
 * object whose `class` is `DUAL_OPERATION` may still have a single writer (both
 * systems run; only one writes), and an object whose class says `SOFT_FREEZE`
 * may name two writers, which is precisely the undeclared dual write this
 * function exists to catch.
 */
export function dualWriteVerdict(object) {
  const writers = [...new Set((object?.writesTo ?? []).filter((w) => WRITE_SYSTEMS.includes(w)))]
  if (writers.length < 2) {
    return Object.freeze({ allowed: false, dualWrite: false, writers: Object.freeze(writers) })
  }

  const proofs = object?.dualWriteProofs ?? {}
  const missing = DUAL_WRITE_PROOFS.filter((p) => !proof(proofs[p.key])).map((p) => p.key)

  // The class is part of the permission, not decoration. §12.5 permits dual
  // operation only as a named classification; a dual write hiding under
  // HARD_FREEZE is the case where the plan says "frozen" and the data moves.
  const wrongClass = object?.class !== "DUAL_OPERATION"

  if (missing.length > 0 || wrongClass) {
    return Object.freeze({
      allowed: false,
      dualWrite: true,
      writers: Object.freeze(writers),
      missing: Object.freeze(missing),
      wrongClass,
    })
  }
  return Object.freeze({ allowed: true, dualWrite: true, writers: Object.freeze(writers) })
}

/**
 * Every way one classified object can contradict §12.5, in a stable order.
 *
 * `scopeObjects` is the list of objects and processes the cutover covers, and it
 * is a separate input from the classifications so that "every object/process is
 * classified" can be checked at all. A plan that classifies what it remembered
 * and omits the rest passes any check that only reads the classifications.
 */
export function freezeProblems(plan) {
  const problems = []
  const bad = (object, reason, detail) => problems.push(problem(object, reason, detail))

  const classified = new Map()
  for (const object of plan?.objects ?? []) {
    const name = object?.object?.trim()
    if (!name) {
      bad(
        "(unnamed)",
        "malformed",
        "A freeze classification with no object name cannot be matched to anything in scope, " +
          "and an entry nothing can be matched to is a claim rather than a classification.",
      )
      continue
    }
    if (classified.has(name)) {
      bad(
        name,
        "duplicate",
        `"${name}" is classified twice. Two freeze classes for one object means whichever a ` +
          `reader finds first decides whether the source may still be written.`,
      )
    }
    classified.set(name, object)

    if (!FREEZE_CLASSES.includes(object.class)) {
      bad(
        name,
        "unknown-class",
        `"${object.class}" is not a freeze class. One of: ${FREEZE_CLASSES.join(", ")}.`,
      )
      continue
    }

    if (!proof(object.cutoff)) {
      bad(
        name,
        "no-cutoff",
        "Every class in §12.5 is defined relative to a cutoff — hard freeze forbids change " +
          "'after cutoff', soft freeze permits it 'only through approved exception'. A class " +
          "with no cutoff names a rule with no moment it starts applying.",
      )
    }

    switch (object.class) {
      case "HARD_FREEZE":
        // "no source change after cutoff" — so a recorded change after it is a
        // violation of the classification, not a note on it.
        for (const change of object.sourceChangesAfterCutoff ?? []) {
          bad(
            name,
            "hard-freeze-violated",
            `"${name}" is HARD_FREEZE — no source change after cutoff — and records the change ` +
              `"${change}". Reclassify as SOFT_FREEZE with an approved exception and delta ` +
              `capture, or reverse the change; a hard freeze with an exception is a soft freeze ` +
              `that nobody captured a delta for.`,
          )
        }
        break

      case "SOFT_FREEZE":
        // "changes permitted only through approved exception and delta capture"
        // — both halves, because an approved change nobody captured is a change
        // the target never learns about.
        for (const change of object.sourceChangesAfterCutoff ?? []) {
          const exception = (object.approvedExceptions ?? []).find((e) => e?.change === change)
          if (!exception) {
            bad(
              name,
              "soft-freeze-unapproved-change",
              `"${name}" is SOFT_FREEZE and records the change "${change}" with no approved ` +
                `exception. §12.5 permits a change only through one.`,
            )
            continue
          }
          if (!proof(exception.approvedBy)) {
            bad(
              name,
              "soft-freeze-exception-unapproved",
              `The exception for "${change}" names no approver. "Approved exception" is two ` +
                `words and this declaration has one of them.`,
            )
          }
          if (!proof(exception.deltaCapture)) {
            bad(
              name,
              "soft-freeze-no-delta-capture",
              `The exception for "${change}" records no delta capture, so the change is ` +
                `approved at the source and invisible at the target. That does not fail — it ` +
                `silently diverges, which is indistinguishable from a record nobody edited.`,
            )
          }
        }
        break

      case "READ_ONLY_COEXISTENCE":
        // "legacy remains query-only".
        if ((object.writesTo ?? []).includes("legacy")) {
          bad(
            name,
            "read-only-coexistence-writes",
            `"${name}" is READ_ONLY_COEXISTENCE — legacy remains query-only — and names legacy ` +
              `as a writer. One of the two is wrong and the classification is refused rather ` +
              `than resolved, because whichever a later reader believes decides whether the ` +
              `retired system still takes writes.`,
          )
        }
        break

      case "DUAL_OPERATION": {
        const missing = DUAL_OPERATION_PROOFS.filter((p) => !proof(object[p.key])).map((p) => p.key)
        if (missing.length > 0) {
          bad(
            name,
            "dual-operation-unproven",
            `"${name}" declares DUAL_OPERATION without ${missing.join(", ")}. §12.5 allows dual ` +
              `operation "only with explicit system-of-record ownership, direction, ` +
              `deduplication, conflict handling, duration, and exit" — six named things, and ` +
              `${missing.length} of them are absent.`,
          )
        }
        if (proof(object.systemOfRecord) && !WRITE_SYSTEMS.includes(object.systemOfRecord)) {
          bad(
            name,
            "unknown-system-of-record",
            `"${object.systemOfRecord}" is not a write system. Exactly one of ` +
              `${WRITE_SYSTEMS.join(" or ")}, matching packages/module-runtime/src/coexistence.ts.`,
          )
        }
        break
      }

      case "DEFERRED_MIGRATION":
        // "data/process remains legacy with governed link and retirement plan".
        if (!proof(object.governedLink)) {
          bad(
            name,
            "deferred-migration-ungoverned",
            `"${name}" defers migration with no governed link. Deferred data that the target ` +
              `cannot reach is not deferred, it is dropped, and the difference is invisible ` +
              `until someone looks for the record.`,
          )
        }
        if (!proof(object.retirementPlan)) {
          bad(
            name,
            "deferred-migration-never-retires",
            `"${name}" defers migration with no retirement plan. §14 forbids calling a legacy ` +
              `system retired while data remains unexplained, and a deferral with no plan is ` +
              `how the explanation never gets written.`,
          )
        }
        break
    }

    // The dual-write refusal, applied to every class. It is not inside the
    // DUAL_OPERATION case on purpose: the dangerous declaration is the one that
    // names two writers under a class that says nothing about them.
    const verdict = dualWriteVerdict(object)
    if (verdict.dualWrite && !verdict.allowed) {
      const parts = []
      if (verdict.wrongClass) {
        parts.push(
          `it is classified ${object.class}, and §12.5 names dual operation as its own class`,
        )
      }
      if (verdict.missing.length > 0) parts.push(`${verdict.missing.join(", ")} are not proven`)
      bad(
        name,
        "dual-write-prohibited",
        `"${name}" is written by ${verdict.writers.join(" and ")}: ${parts.join("; ")}. §12.5: ` +
          `"Dual writes are prohibited unless conflict semantics, reconciliation, ownership, ` +
          `loop prevention, failure recovery, and sunset are proven."`,
      )
    }
  }

  // "Every object/process is classified." Checked against the declared scope,
  // which is the only way it can be checked.
  for (const name of plan?.scopeObjects ?? []) {
    const trimmed = typeof name === "string" ? name.trim() : ""
    if (!trimmed) continue
    if (!classified.has(trimmed)) {
      bad(
        trimmed,
        "unclassified",
        `"${trimmed}" is in cutover scope and carries no freeze classification. §12.5 opens ` +
          `"Every object/process is classified"; an unclassified object is not frozen, it is ` +
          `undecided, and an undecided source keeps taking writes through T0.`,
      )
    }
  }

  return Object.freeze(problems)
}

/**
 * The freeze classification of one object, or why there is not one.
 *
 * Returns `{ classified: false }` rather than a default class. A default here
 * would be the whole bug: whichever class it defaulted to, an object nobody
 * decided about would read as a decision.
 */
export function classifyObject(plan, name) {
  const found = (plan?.objects ?? []).find((o) => o?.object?.trim() === name?.trim())
  if (!found) {
    return Object.freeze({
      classified: false,
      why: `"${name}" carries no freeze classification in this plan.`,
    })
  }
  return Object.freeze({
    classified: true,
    class: found.class,
    cutoff: found.cutoff ?? null,
    dualWrite: dualWriteVerdict(found),
  })
}
