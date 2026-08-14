import { test, expect, type Page } from "@playwright/test"

import { ALL_STATES, type TenantState } from "@tenure/provisioning"

import { DESTRUCTIVE_VERBS } from "../src/lib/aws/mutate"
import {
  NO_RETAINED_AWS_OBSERVATION,
  observedFor,
  riskOf,
} from "../src/lib/tenant-state"
import {
  DANGER_ZONE_ATTRIBUTE,
  DANGER_ZONE_REGION,
  IRREVERSIBLE,
  RISK_ATTRIBUTE,
  isIrreversible,
} from "../src/components/md3/DangerZone"
import { operatorFor } from "./operator-identity"

/**
 * STUDIO-030-004, as a property of the console rather than of one component.
 *
 * > *Make destructive controls visually and spatially distinct; never place
 * > irreversible tenant/account/key deletion next to ordinary actions.*
 *
 * `components/md3/DangerZone.tsx` is the region that makes the separation
 * automatic for anything that uses it. Nothing obliges a surface to use it. A
 * rule that lives only in a component is a convention, and a convention is
 * exactly what the requirement is not asking for — so this walks every rendered
 * page and fails on the property itself, whatever built the markup.
 *
 * ## What counts as irreversible, and where the answer comes from
 *
 * Not a list kept here. Two vocabularies, both imported from the code that
 * owns them:
 *
 *   * **The lifecycle graph.** `riskOf` (`lib/tenant-state.ts`) writes
 *     `IRREVERSIBLE` for a destination from which `canReachServing` finds no
 *     route back to serving. This spec calls `riskOf` for every state in
 *     `ALL_STATES` and keeps the ones it classifies that way — today PURGING
 *     and PURGED_ZERO_INCREMENTAL_COST, tomorrow whatever the graph says.
 *   * **The mutation gate.** `DESTRUCTIVE_VERBS` (`lib/aws/mutate.ts`) is the
 *     console's own answer to "which verbs does trying again not undo":
 *     terminate, delete, revoke, scale-to-zero. Those are the account and key
 *     half of the requirement's sentence, which the lifecycle graph says
 *     nothing about.
 *
 * Both are reduced to stems mechanically — `PURGING` → `purg`, `delete` →
 * `delet` — so `Purge`, `purged`, `Deletion` and `Revoking` all match without
 * anybody maintaining a list of word endings. A control also counts when it
 * says so itself, through the `data-risk` attribute `DangerZone` emits.
 *
 * ## What counts as "next to"
 *
 * Three conditions, any one of which fails the pair. They are separate because
 * they fail for different reasons:
 *
 *   1. **Same button group.** The nearest common ancestor of the two controls
 *      holds no text of its own — every word inside it belongs to a control. A
 *      row of chips is exactly that shape, and it is the shape this requirement
 *      was written about.
 *   2. **Same card, row or cell.** The nearest common ancestor is a `fieldset`,
 *      a card, a list item, a table row or cell, or a declared group/toolbar.
 *      Separated by nothing an operator can see.
 *   3. **Too close to be a different decision.** The rectangles are within
 *      `MINIMUM_GAP_PX` of one another. This is the one that survives a
 *      restyle: a page can keep every class name and every wrapper and still
 *      pull the two groups flush, and `layout.spec.ts` measures that on the one
 *      route it knows about. Same floor, so the two agree.
 *
 * Each route is measured twice: as it loads, and again with a one-way move
 * chosen — the state in which the confirmation panel, the typed-target field
 * and the submit button that performs the purge are all on the page at once.
 *
 * ## Why it would be easy for this to assert nothing
 *
 * A crawl that signs in badly, or that visits pages with no controls on them,
 * finds no irreversible control anywhere and reports a clean console. So the
 * last test in the file fails unless the walk actually found one, named the
 * route it was on, and found ordinary controls to compare it against. An
 * absence check over an empty set is the failure mode this whole requirement is
 * about.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""

test.beforeAll(() => {
  expect(OPERATOR, "PLATFORM_OPERATORS must be set").not.toBe("")
  expect(SECRET, "PLATFORM_OPERATOR_SECRET must be set").not.toBe("")
})

/**
 * The floor, matching `e2e/layout.spec.ts`'s minimum vertical separation.
 *
 * Deliberately the same number: two specs measuring the same gap with two
 * different floors is a console where one of them is wrong and nobody knows
 * which.
 */
const MINIMUM_GAP_PX = 16

/* ── The vocabulary, derived ──────────────────────────────────────────────── */

/** A real observation, so `riskOf` is called the way the tenant page calls it. */
const OBSERVED = observedFor({
  isolation: "pooled",
  hasDeployment: true,
  serving: false,
  evidenceRecords: 2,
})

/**
 * Every lifecycle destination `riskOf` calls irreversible.
 *
 * `from` is fixed at ACTIVE because the class of a move is a property of its
 * destination alone — `destroysTenant` in `lib/tenant-state.ts` says so, and
 * `canReachServing` walks forward from the target.
 */
const IRREVERSIBLE_STATES: readonly TenantState[] = ALL_STATES.filter((state) =>
  isIrreversible(riskOf("any-tenant", "ACTIVE", state, NO_RETAINED_AWS_OBSERVATION, OBSERVED)),
)

/**
 * A word stem, from a state name or a verb, without a table of endings.
 *
 * `PURGING` and `PURGED_ZERO_INCREMENTAL_COST` both start with the same act, so
 * the first underscore-separated word is taken and its participle ending
 * removed: `purg`. A verb loses a trailing `e`: `delete` → `delet`. Matching
 * `\bstem[a-z]*\b` then covers purge/purges/purged/purging and
 * delete/deleted/deleting/deletion, which is every form these two words reach a
 * button in.
 */
function stemOf(word: string): string {
  const first = word.split("_")[0].toLowerCase()
  return first.replace(/(ing|ed)$/, "").replace(/e$/, "")
}

/**
 * The patterns a control's accessible name is matched against.
 *
 * Sources, in order: the full state names (exact, so `PURGE_PENDING` is not
 * mistaken for `PURGING`), the state stems, and the destructive verb stems.
 * Hyphenated verbs match with a space too, because `scale-to-zero` is written
 * one way in the code and the other way on a button.
 */
const IRREVERSIBLE_PATTERNS: readonly string[] = [
  ...IRREVERSIBLE_STATES.map((state) => String.raw`\b${state}\b`),
  ...IRREVERSIBLE_STATES.map((state) => stemOf(state)),
  ...[...DESTRUCTIVE_VERBS].map((verb) => stemOf(verb)),
]
  // A two-or-three letter stem would match half the console. Nothing in either
  // vocabulary produces one today; this is what happens if something does.
  .filter((pattern) => pattern.length >= 4)
  .map((pattern) =>
    pattern.startsWith("\\b") ? pattern : String.raw`\b${pattern.replace(/-/g, "[- ]")}[a-z]*\b`,
  )

/** Does this accessible name name an irreversible act? */
function namesIrreversibleAct(label: string): boolean {
  return IRREVERSIBLE_PATTERNS.some((pattern) => new RegExp(pattern, "i").test(label))
}

/* ── The vocabulary is checked before it is trusted ───────────────────────── */

test.describe("the guard knows what irreversible means", () => {
  test("the states come from riskOf, and there are some", () => {
    // An empty vocabulary makes every assertion below pass on every page.
    expect(IRREVERSIBLE_STATES.length).toBeGreaterThan(0)
    expect([...IRREVERSIBLE_STATES]).toEqual(["PURGING", "PURGED_ZERO_INCREMENTAL_COST"])
    // And it is genuinely derived: every one of them is a state riskOf refuses
    // to call reversible, and every other state is one it does.
    for (const state of ALL_STATES) {
      const risk = riskOf("any-tenant", "ACTIVE", state, NO_RETAINED_AWS_OBSERVATION, OBSERVED)
      expect(
        isIrreversible(risk),
        `${state}: riskOf says ${risk.reversibility}`,
      ).toBe(IRREVERSIBLE_STATES.includes(state))
    }
  })

  test("the verbs come from the mutation gate", () => {
    // Named rather than counted: a verb dropped from that set is a control this
    // guard stops looking at, and the count alone would not say which.
    expect([...DESTRUCTIVE_VERBS].sort()).toEqual([
      "delete",
      "revoke",
      "scale-to-zero",
      "terminate",
    ])
  })

  test("it recognises the words a control actually says", () => {
    for (const label of [
      "PURGING",
      "Move to PURGING",
      "Purge tenant",
      "Purged",
      "Delete account",
      "Deleting this key",
      "Revoke access key",
      "Terminate the task",
      "Scale to zero",
    ]) {
      expect(namesIrreversibleAct(label), `${label} was not recognised`).toBe(true)
    }
  })

  test("it does not recognise the ordinary ones", () => {
    for (const label of [
      "LEGAL_HOLD",
      "OFFBOARDING",
      "PURGE_PENDING",
      "SUSPENDING",
      "Save",
      "Export evidence",
      "Sign out",
      "Tenants",
      "Create tenant",
    ]) {
      expect(namesIrreversibleAct(label), `${label} was wrongly flagged`).toBe(false)
    }
  })
})

/* ── The walk ─────────────────────────────────────────────────────────────── */

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForLoadState("networkidle")
  /*
   * Checked, not assumed. The shell — nav, header, every link in it — renders
   * for an unauthenticated visitor too, so a sign-in that quietly failed walks
   * a console with no tenant pages in it, finds no irreversible control, and
   * reports the whole estate clean. That is not a hypothetical: it is what this
   * spec did on its first run against a server whose registry it could not
   * reach.
   */
  await expect(
    page,
    "sign-in did not leave /signin — the walk would be of an unauthenticated console",
  ).not.toHaveURL(/\/signin/)
}

/**
 * The routes this guard is not allowed to stop visiting.
 *
 * A declared floor rather than only a crawl: a nav that loses a link would
 * silently shrink the walk, and the page that lost its link is exactly the page
 * whose controls nobody is looking at any more. The crawl below adds whatever
 * else the console links to.
 *
 * `seed-deployed` is `PURGE_PENDING` — the one lifecycle state whose successors
 * include both an irreversible move and ordinary ones — and it is seeded by
 * `tools/dev/seed-studio-fleet.mjs`.
 */
const FLOOR_ROUTES = [
  "/",
  "/tenants",
  "/tenants/new",
  "/tenants/seed-deployed",
  "/tenants/seed-nodeploy",
  "/tenants/seed-elsewhere",
  "/tenants/seed-deployed/configuration",
  "/platform",
  "/platform/audit",
  "/platform/compute",
  "/platform/cost",
  "/platform/data",
  "/platform/diagnostics",
  "/platform/estate",
  "/platform/health",
  "/platform/identity",
  "/platform/messaging",
  "/platform/network",
  "/platform/security",
]

/** Ceiling on the crawl, so a link loop cannot turn this into an hour. */
const MAX_ROUTES = 40

async function routesToWalk(page: Page): Promise<string[]> {
  const found = new Set(FLOOR_ROUTES)
  for (const seed of ["/", "/tenants", "/platform"]) {
    await page.goto(seed)
    await page.waitForLoadState("networkidle")
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .map((a) => a.getAttribute("href") ?? "")
        .filter((href) => href.startsWith("/") && !href.startsWith("//")),
    )
    for (const href of hrefs) {
      const clean = href.split("#")[0]
      if (!clean || clean.startsWith("/api/") || clean === "/signout") continue
      found.add(clean)
      if (found.size >= MAX_ROUTES) break
    }
  }
  return [...found].sort()
}

interface Finding {
  route: string
  width: number
  irreversible: string
  ordinary: string
  reason: string
  container: string
  gap: number
}

/**
 * Every irreversible/ordinary pair on the page that is not properly separated.
 *
 * Runs in the page because all three conditions are measurements of the
 * rendered layout — the nearest common ancestor, whether that ancestor holds
 * text of its own, and the distance between two rectangles. None of them can be
 * read off the source.
 */
async function inspect(page: Page): Promise<{
  irreversible: number
  ordinary: number
  findings: Array<Omit<Finding, "route" | "width">>
}> {
  return page.evaluate(
    ({ patterns, minimumGap, riskAttribute, irreversibleValue, zoneAttribute, zoneRegion }) => {
      const CONTROLS =
        'button, a[href], [role="button"], input[type="submit"], input[type="button"]'
      /** Containers that are a row, a card or a cell — nothing separates inside one. */
      const CARDS =
        'fieldset, li, td, th, tr, [role="group"], [role="toolbar"], .md3-card, .card, .row, .actions, .chips'

      const nameOf = (el: Element): string =>
        (
          el.getAttribute("aria-label") ||
          el.textContent ||
          // `value` after `textContent`: a <button name="to" value="PURGING">
          // in a server-action form carries both, and the one an operator reads
          // is the text.
          (el as HTMLInputElement).value ||
          el.getAttribute("title") ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()

      const visible = (el: Element): boolean => {
        const style = getComputedStyle(el)
        if (style.display === "none" || style.visibility === "hidden") return false
        if (Number(style.opacity) === 0) return false
        const r = el.getBoundingClientRect()
        return r.width >= 2 && r.height >= 2
      }

      const regexes = patterns.map((p) => new RegExp(p, "i"))

      const controls = Array.from(document.querySelectorAll(CONTROLS)).filter(visible)
      const classified = controls.map((el) => {
        const label = nameOf(el)
        const declared = el.closest(`[${riskAttribute}]`)?.getAttribute(riskAttribute) ?? null
        const irreversible =
          declared === irreversibleValue || (declared === null && regexes.some((r) => r.test(label)))
        return { el, label, irreversible }
      })

      const irreversible = classified.filter((c) => c.irreversible)
      const ordinary = classified.filter((c) => !c.irreversible)

      const ancestors = (el: Element): Element[] => {
        const chain: Element[] = []
        for (let node: Element | null = el; node; node = node.parentElement) chain.unshift(node)
        return chain
      }

      const nearestCommon = (a: Element, b: Element): Element => {
        const left = ancestors(a)
        const right = ancestors(b)
        let common: Element = document.documentElement
        for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
          if (left[i] !== right[i]) break
          common = left[i]
        }
        return common
      }

      /** An element whose every word belongs to a control inside it. */
      const isPureControlGroup = (el: Element): boolean => {
        if (el === document.body || el === document.documentElement) return false
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!(node.textContent ?? "").trim()) continue
          const owner = node.parentElement?.closest(CONTROLS)
          if (!owner || !el.contains(owner)) return false
        }
        return true
      }

      const gapBetween = (a: Element, b: Element): number => {
        const x = a.getBoundingClientRect()
        const y = b.getBoundingClientRect()
        const dx = Math.max(0, Math.max(x.left, y.left) - Math.min(x.right, y.right))
        const dy = Math.max(0, Math.max(x.top, y.top) - Math.min(x.bottom, y.bottom))
        return Math.round(Math.hypot(dx, dy))
      }

      const describe = (el: Element): string =>
        el.tagName.toLowerCase() +
        (el.id ? `#${el.id}` : "") +
        (typeof el.className === "string" && el.className
          ? `.${el.className.trim().split(/\s+/).join(".")}`
          : "") +
        (el.hasAttribute(zoneAttribute) ? `[${zoneAttribute}=${el.getAttribute(zoneAttribute)}]` : "")

      const findings: Array<{
        irreversible: string
        ordinary: string
        reason: string
        container: string
        gap: number
      }> = []

      for (const one of irreversible) {
        for (const other of ordinary) {
          const common = nearestCommon(one.el, other.el)
          const gap = gapBetween(one.el, other.el)
          const reasons: string[] = []

          if (isPureControlGroup(common)) reasons.push("same button group")
          if (common.matches(CARDS)) reasons.push("same card, row or cell")
          if (gap < minimumGap) reasons.push(`${gap}px apart, floor is ${minimumGap}px`)

          // An ordinary control INSIDE the separated region is the region
          // failing at its one job, and it is worth naming as such.
          const region = one.el.closest(`[${zoneAttribute}="${zoneRegion}"], fieldset.destructive`)
          if (region && region.contains(other.el)) reasons.push("inside the separated region")

          if (reasons.length > 0) {
            findings.push({
              irreversible: one.label,
              ordinary: other.label,
              reason: reasons.join("; "),
              container: describe(common),
              gap,
            })
          }
        }
      }
      return { irreversible: irreversible.length, ordinary: ordinary.length, findings }
    },
    {
      patterns: [...IRREVERSIBLE_PATTERNS],
      minimumGap: MINIMUM_GAP_PX,
      riskAttribute: RISK_ATTRIBUTE,
      irreversibleValue: IRREVERSIBLE,
      zoneAttribute: DANGER_ZONE_ATTRIBUTE,
      zoneRegion: DANGER_ZONE_REGION,
    },
  )
}

/**
 * Widths, because the separation is a layout property and a layout property is
 * width-dependent. 320 is WCAG 2.2 AA 1.4.10 reflow, where a row that wrapped
 * politely at 1440 becomes two controls stacked a few pixels apart.
 */
const WIDTHS = [1440, 900, 320]

/** Filled by the walk, read by the last test in the file. */
const seen = { routes: 0, irreversibleControls: 0, ordinaryControls: 0, routesWithOne: [] as string[] }

for (const width of WIDTHS) {
  test(`no irreversible control shares a container with an ordinary one at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await page.setViewportSize({ width, height: 1000 })
    await signIn(page)

    const routes = await routesToWalk(page)
    expect(routes.length, "the crawl found fewer routes than the declared floor").toBeGreaterThanOrEqual(
      FLOOR_ROUTES.length,
    )

    const findings: Finding[] = []
    for (const route of routes) {
      await page.goto(route)
      await page.waitForLoadState("networkidle")

      const report = await inspect(page)

      seen.routes += 1
      seen.irreversibleControls += report.irreversible
      seen.ordinaryControls += report.ordinary
      if (report.irreversible > 0 && !seen.routesWithOne.includes(route)) {
        seen.routesWithOne.push(route)
      }

      for (const finding of report.findings) findings.push({ ...finding, route, width })

      /*
       * And again with the one-way move CHOSEN.
       *
       * Selecting a destination on the tenant page re-lays the whole block out:
       * a confirmation panel, a typed-target field, an approver field and a
       * submit button appear between the groups, and the submit button is
       * itself an irreversible control — `Move <slug> to PURGING`. A guard that
       * only ever measured the resting state would never look at the layout an
       * operator is actually in when the click that matters happens.
       *
       * Nothing is submitted: the chip only chooses. No row is created, so
       * there is nothing to tear down.
       */
      const chooseOneWay = page
        .locator(`[${RISK_ATTRIBUTE}="${IRREVERSIBLE}"], fieldset.destructive .chip`)
        .first()
      if ((await chooseOneWay.count()) > 0) {
        await chooseOneWay.click()
        await page.waitForLoadState("networkidle")
        const chosen = await inspect(page)
        for (const finding of chosen.findings) {
          findings.push({ ...finding, route: `${route} (one-way move chosen)`, width })
        }
      }
    }

    expect(
      findings.map(
        (f) =>
          `${f.route} @${f.width}px — "${f.irreversible}" beside "${f.ordinary}" in ${f.container} ` +
          `(${f.reason})`,
      ),
      "An irreversible control is sharing a container with an ordinary one. STUDIO-030-004: put " +
        "it in a DangerZone (components/md3/DangerZone.tsx), which places it in its own " +
        "fieldset.destructive after the ordinary group.",
    ).toEqual([])
  })
}

/* ── The guard is not allowed to have looked at nothing ───────────────────── */

test("the walk actually found an irreversible control to separate", async () => {
  // Ordered last in the file so the walks above have run. Without this, a
  // sign-in that silently failed, a vocabulary that stopped matching, or a
  // fixture that stopped seeding `seed-deployed` all produce a clean, green,
  // meaningless run.
  expect(seen.routes, "no route was walked at all").toBeGreaterThanOrEqual(FLOOR_ROUTES.length)
  expect(
    seen.routesWithOne,
    "no page in the console rendered a control this guard classifies as irreversible — either " +
      "the fleet was not seeded (tools/dev/seed-studio-fleet.mjs puts seed-deployed in " +
      "PURGE_PENDING) or the classification stopped matching. Either way the assertions above " +
      "compared nothing.",
  ).not.toEqual([])
  // Named, not merely counted. `seed-deployed` is PURGE_PENDING, whose one-way
  // successor is the purge itself — if the walk found irreversible controls
  // everywhere except there, the classification has drifted onto something else.
  expect(
    seen.routesWithOne,
    "the PURGE_PENDING tenant's page did not render an irreversible control",
  ).toContain("/tenants/seed-deployed")
  expect(seen.ordinaryControls, "no ordinary control to compare against").toBeGreaterThan(0)
})
