/**
 * WRK-020-001 — every one of Bible §4.1's eight connection classes, pinned at
 * its own ceiling.
 *
 * ## Why this file exists beside `connection-class.test.ts`
 *
 * The existing suite proves the mechanism: that a refusal names both classes,
 * that the narrowest carrier is chosen, that `PERSONAL_PRODUCTIVITY` is refused
 * outright, and — through `relay-tools.test.ts` and the route suite — that the
 * gate is genuinely reached on every `/api/ai/chat` request. What it does NOT do
 * is assert what each class's authority IS. Its only per-class check is
 * `expect(RISK_ORDER).toContain(authority.maxRisk)`, which every one of the
 * seven risk names satisfies, and four of the eight classes appear in no other
 * assertion at all.
 *
 * The consequence was measured rather than imagined: raising
 * `CLASS_AUTHORITY.FILE_OR_FEED.maxRisk` from `BULK` to `DELETE` — an SFTP,
 * object-store, ICS or EDI feed authorised to delete tenant records — left the
 * whole relay suite green. The requirement's own sentence is "implement EVERY
 * connection class", and a class whose declared authority nothing asserts is
 * decoration, not an implemented constraint.
 *
 * ## Why the assertions are behavioural and not only structural
 *
 * Each class is pinned twice: the literal it declares, and the BOUNDARY that
 * literal produces through `refuseEscalation` — the act at the ceiling is
 * allowed, the next act up the ladder is refused. A structural check alone
 * would pass if `refuseEscalation` stopped reading `CLASS_AUTHORITY`; a
 * behavioural check alone would pass if a ceiling and the comparison drifted in
 * the same direction. Both directions of every ceiling therefore fail loudly:
 * raising one reds the "and no further" case, lowering one reds the "reaches"
 * case.
 *
 * Nothing here is measured off this machine — every number is an index into
 * `RISK_ORDER`, which is a token list, not data.
 */

import { CONNECTION_CLASSES, type ConnectionClass } from "@tenure/platform-config"

import { CLASS_AUTHORITY, RISK_ORDER, leastClassFor, refuseEscalation } from "./connection-class"
import type { ActionRiskClass } from "../relay-tools"

/**
 * §4.1's eight, each with the most consequential act it may reach and whether
 * it may serve the tenant at all.
 *
 * Written as literals rather than read back out of `CLASS_AUTHORITY`, which
 * would be the table asserting that it equals itself.
 */
const DECLARED: ReadonlyArray<{
  cls: ConnectionClass
  ceiling: ActionRiskClass
  tenantWide: boolean
}> = [
  { cls: "USER_DELEGATED", ceiling: "DELETE", tenantWide: true },
  { cls: "ADMIN_DELEGATED", ceiling: "PRIVILEGED", tenantWide: true },
  { cls: "APPLICATION_ORG_WIDE", ceiling: "DELETE", tenantWide: true },
  { cls: "BOT_OR_APP_INSTALLATION", ceiling: "EXTERNAL_SHARE", tenantWide: true },
  { cls: "SERVICE_ACCOUNT", ceiling: "BULK", tenantWide: true },
  { cls: "WEBHOOK_ONLY", ceiling: "READ", tenantWide: true },
  { cls: "FILE_OR_FEED", ceiling: "BULK", tenantWide: true },
  { cls: "PERSONAL_PRODUCTIVITY", ceiling: "DRAFT", tenantWide: false },
]

/** The act one step more consequential than `risk`, or null at the top. */
function nextUp(risk: ActionRiskClass): ActionRiskClass | null {
  const at = RISK_ORDER.indexOf(risk)
  return at >= 0 && at + 1 < RISK_ORDER.length ? RISK_ORDER[at + 1] : null
}

describe("every §4.1 class is pinned, not just the ones a story was written about", () => {
  it("covers all eight, so a ninth class cannot arrive unasserted", () => {
    expect(DECLARED.map((d) => d.cls)).toEqual([...CONNECTION_CLASSES])
    expect(DECLARED).toHaveLength(8)
  })

  it.each(DECLARED)("$cls declares its ceiling as $ceiling", ({ cls, ceiling, tenantWide }) => {
    expect(CLASS_AUTHORITY[cls].maxRisk).toBe(ceiling)
    expect(CLASS_AUTHORITY[cls].tenantWide).toBe(tenantWide)
  })
})

describe("each ceiling is a boundary the gate actually enforces", () => {
  it.each(DECLARED.filter((d) => d.tenantWide))(
    "$cls reaches $ceiling and refuses the act above it",
    ({ cls, ceiling }) => {
      // At the ceiling: allowed, and the verdict reports the ceiling back so a
      // caller can say what the grant reaches without a second lookup.
      const allowed = refuseEscalation(cls, ceiling)
      expect(allowed.ok).toBe(true)
      expect(allowed.ceiling).toBe(ceiling)

      // One step up: refused, naming the grant, the act and the ceiling.
      const above = nextUp(ceiling)
      if (above === null) {
        // Only ADMIN_DELEGATED sits at the top of the ladder; there is no act
        // above PRIVILEGED for it to refuse, and asserting one would be
        // asserting against a risk vocabulary this platform does not have.
        expect(cls).toBe("ADMIN_DELEGATED")
        return
      }
      const refused = refuseEscalation(cls, above)
      expect(refused.ok).toBe(false)
      if (refused.ok) return
      expect(refused.grantedClass).toBe(cls)
      expect(refused.requestedRisk).toBe(above)
      expect(refused.ceiling).toBe(ceiling)
      expect(refused.reason).toContain(cls)
      expect(refused.reason).toContain(above)
    },
  )

  it("refuses every act on the one class §4.1 keeps out of tenant-wide use", () => {
    // Not a narrower ceiling — a refusal of the class on this path, because a
    // relay tool is tenant-wide by construction.
    for (const risk of RISK_ORDER) {
      const verdict = refuseEscalation("PERSONAL_PRODUCTIVITY", risk)
      expect(verdict.ok).toBe(false)
      if (verdict.ok) continue
      expect(verdict.requestedRisk).toBe(risk)
    }
  })

  it("lets a feed move data in volume and go no further", () => {
    // The class this file was opened on. FILE_OR_FEED is the one class whose
    // `because` names a transport this platform genuinely ships (the ICS
    // feed), and it carries no identity that could authorise an external send
    // or a deletion — so BULK is the ceiling and EXTERNAL_SHARE is not.
    expect(refuseEscalation("FILE_OR_FEED", "BULK").ok).toBe(true)
    const shared = refuseEscalation("FILE_OR_FEED", "EXTERNAL_SHARE")
    expect(shared.ok).toBe(false)
    const deleted = refuseEscalation("FILE_OR_FEED", "DELETE")
    expect(deleted.ok).toBe(false)
    if (deleted.ok) return
    expect(deleted.requiredClass).toBe("USER_DELEGATED")
  })
})

describe("the ladder, read across all eight rather than one class at a time", () => {
  it("names the narrowest class that carries each act, for every act", () => {
    // Derived from the eight ceilings above, so this is the table's shape and
    // not a second opinion about it. A ceiling that moves moves an answer here.
    expect(leastClassFor("READ")).toBe("WEBHOOK_ONLY")
    expect(leastClassFor("DRAFT")).toBe("SERVICE_ACCOUNT")
    expect(leastClassFor("WRITE")).toBe("SERVICE_ACCOUNT")
    expect(leastClassFor("BULK")).toBe("SERVICE_ACCOUNT")
    expect(leastClassFor("EXTERNAL_SHARE")).toBe("BOT_OR_APP_INSTALLATION")
    expect(leastClassFor("DELETE")).toBe("USER_DELEGATED")
    expect(leastClassFor("PRIVILEGED")).toBe("ADMIN_DELEGATED")
  })

  it("never names a class that could not carry the act", () => {
    for (const risk of RISK_ORDER) {
      const carrier = leastClassFor(risk)
      expect(carrier).not.toBeNull()
      if (carrier === null) continue
      const authority = CLASS_AUTHORITY[carrier]
      expect(authority.tenantWide).toBe(true)
      expect(RISK_ORDER.indexOf(authority.maxRisk)).toBeGreaterThanOrEqual(RISK_ORDER.indexOf(risk))
      // And the class it names really does accept the act.
      expect(refuseEscalation(carrier, risk).ok).toBe(true)
    }
  })

  it("gives exactly one class the privileged act, and it is the one with an approver", () => {
    const reachingPrivileged = CONNECTION_CLASSES.filter(
      (cls) => refuseEscalation(cls, "PRIVILEGED").ok,
    )
    expect(reachingPrivileged).toEqual(["ADMIN_DELEGATED"])
  })
})
