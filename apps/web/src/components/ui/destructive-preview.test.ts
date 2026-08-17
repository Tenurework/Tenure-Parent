/**
 * GE-143-025 — the preview contract, and a census of the surfaces that follow it.
 *
 * The last two cases are the ones that matter to the requirement's word
 * "standardize": a standard nothing is measured against is a suggestion. They
 * walk every product module, find every confirmation element, and require each
 * destructive one to either carry a preview or be named in the migration
 * register with a reason.
 */
import fs from "node:fs"
import path from "node:path"

import {
  DESTRUCTIVE_PREVIEW_BACKLOG,
  DISCLOSURE_LABELS,
  DISCLOSURE_ORDER,
  affectedSentence,
  auditSentence,
  confirmationSites,
  costSentence,
  disclosureSentence,
  isKnown,
  listSentence,
  recoverySentence,
  scopeSentence,
  validateDestructivePreview,
  type DestructivePreview,
  type Disclosure,
} from "./destructive-preview"

const APP_ROOT = path.resolve(__dirname, "../../..")

/** A complete, valid preview. Every case below starts from this and breaks one thing. */
function completePreview(): DestructivePreview {
  return {
    target: { known: { kind: "board seat", label: "Treasurer", identifier: "position ID TRE-1" } },
    scope: {
      known: {
        tenant: "Example University",
        organization: "Robotics Club",
        seat: "Treasurer",
        crossOrganization: false,
      },
    },
    affected: { known: { count: 0, noun: "attached record" } },
    downstream: { known: [] },
    approvals: { known: [] },
    recovery: { known: { kind: "irreversible", why: "The row is deleted outright." } },
    retention: { known: "Nothing is retained and no legal hold is affected." },
    cost: { known: null },
    audit: { known: { kind: "recorded", event: "seat.deleted" } },
  }
}

function productModules(): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|itest)\.tsx?$/.test(entry.name)) files.push(full)
    }
  }
  walk(path.join(APP_ROOT, "src/app"))
  walk(path.join(APP_ROOT, "src/components"))
  return files
}

describe("the disclosure set", () => {
  it("is the nine the requirement names, in its order", () => {
    expect([...DISCLOSURE_ORDER]).toEqual([
      "target",
      "scope",
      "affected",
      "downstream",
      "approvals",
      "recovery",
      "retention",
      "cost",
      "audit",
    ])
    for (const key of DISCLOSURE_ORDER) expect(DISCLOSURE_LABELS[key].length).toBeGreaterThan(3)
  })
})

describe("validateDestructivePreview", () => {
  it("accepts a complete preview", () => {
    expect(validateDestructivePreview(completePreview())).toEqual([])
  })

  it("names each disclosure that is missing", () => {
    const preview = completePreview() as unknown as Record<string, unknown>
    delete preview.retention
    delete preview.cost
    expect(validateDestructivePreview(preview)).toEqual([
      "Retention and legal hold was not disclosed at all.",
      "Cost was not disclosed at all.",
    ])
  })

  it("refuses `unavailable` with no reason", () => {
    // The blank this type exists to outlaw, wearing a different name.
    const preview = { ...completePreview(), affected: { unavailable: "" } }
    expect(validateDestructivePreview(preview)).toEqual([
      "How many records says it is unavailable without saying why, which tells the reader nothing.",
    ])
  })

  it("accepts `unavailable` with one", () => {
    const preview = {
      ...completePreview(),
      affected: { unavailable: "the count query timed out" },
    }
    expect(validateDestructivePreview(preview)).toEqual([])
  })

  it("refuses a disclosure claiming both a value and a reason", () => {
    const preview = {
      ...completePreview(),
      cost: { known: "$40/month", unavailable: "billing was unreachable" },
    }
    expect(validateDestructivePreview(preview)).toEqual([
      "Cost claims both a value and a reason it could not be computed.",
    ])
  })

  it("refuses a disclosure that is neither", () => {
    const preview = { ...completePreview(), downstream: { effects: [] } }
    expect(validateDestructivePreview(preview)).toEqual([
      "What else changes is neither a value nor a reason one could not be computed.",
    ])
  })

  it("refuses a non-object", () => {
    expect(validateDestructivePreview(null)).toHaveLength(1)
    expect(validateDestructivePreview("everything is fine")).toHaveLength(1)
  })
})

describe("the sentences keep zero and unknown apart", () => {
  it("says a count of zero was checked, and never renders it as a blank", () => {
    expect(affectedSentence({ count: 0, noun: "assignment" })).toBe(
      "None — checked, and no assignments are attached",
    )
    expect(affectedSentence({ count: 1, noun: "assignment" })).toBe("1 assignment")
    expect(affectedSentence({ count: 4, noun: "assignment" })).toBe("4 assignments")
  })

  it("renders an unavailable disclosure as its reason, not as nothing", () => {
    const preview: DestructivePreview = {
      ...completePreview(),
      affected: { unavailable: "the count query timed out" },
    }
    expect(disclosureSentence(preview, "affected")).toBe(
      "Not determined — the count query timed out",
    )
    // And the two are not the same string, which is the whole point.
    expect(disclosureSentence(preview, "affected")).not.toBe(
      disclosureSentence(completePreview(), "affected"),
    )
  })

  it("distinguishes no cost from no cost figure", () => {
    expect(costSentence(null)).toBe("No cost impact.")
    expect(
      disclosureSentence({ ...completePreview(), cost: { unavailable: "billing was unreachable" } }, "cost"),
    ).toBe("Not determined — billing was unreachable")
  })

  it("distinguishes nothing downstream from nothing known", () => {
    expect(listSentence([], "Nothing else — checked.")).toBe("Nothing else — checked.")
    expect(listSentence(["Two saved views lose their filter"], "Nothing else — checked.")).toBe(
      "Two saved views lose their filter",
    )
  })

  it("says out loud when nothing will be recorded", () => {
    expect(auditSentence({ kind: "recorded", event: "seat.deleted" })).toBe(
      "Recorded as seat.deleted.",
    )
    expect(auditSentence({ kind: "not-recorded", why: "the action writes no audit event." })).toBe(
      "Nothing is recorded. the action writes no audit event.",
    )
  })

  it("states an undo window in minutes, or that there is none", () => {
    expect(recoverySentence({ kind: "undo-window", minutes: 1, how: "Use Undo in the banner." })).toBe(
      "Yes, for 1 minute. Use Undo in the banner.",
    )
    expect(recoverySentence({ kind: "undo-window", minutes: 30, how: "Use Undo." })).toBe(
      "Yes, for 30 minutes. Use Undo.",
    )
    expect(recoverySentence({ kind: "irreversible", why: "The row is deleted." })).toBe(
      "No. The row is deleted.",
    )
  })

  it("says whether the blast radius leaves the organization", () => {
    const inside = scopeSentence({
      tenant: "Example University",
      organization: "Robotics Club",
      seat: null,
      crossOrganization: false,
    })
    const beyond = scopeSentence({
      tenant: "Example University",
      organization: "Robotics Club",
      seat: null,
      crossOrganization: true,
    })
    expect(inside).toContain("inside this organization only")
    expect(beyond).toContain("reaches beyond this organization")
    expect(inside).not.toBe(beyond)
  })

  it("reports known-ness for every disclosure of a mixed preview", () => {
    const preview: DestructivePreview = {
      ...completePreview(),
      retention: { unavailable: "the retention policy service did not answer" },
    }
    const states = DISCLOSURE_ORDER.map(
      (key) => [key, isKnown(preview[key] as Disclosure<unknown>)] as const,
    )
    expect(states).toEqual([
      ["target", true],
      ["scope", true],
      ["affected", true],
      ["downstream", true],
      ["approvals", true],
      ["recovery", true],
      ["retention", false],
      ["cost", true],
      ["audit", true],
    ])
  })
})

describe("the confirmation-site scanner", () => {
  it("reads the props of an opening tag across lines and through nested braces", () => {
    const source = `
      <ConfirmSubmit
        action={adminDeleteSeat}
        title={\`Delete the \${role.name} seat?\`}
        preview={{ target: { known: { kind: "seat" } } }}
        variant="danger"
      >
        <Trash2 /> Delete
      </ConfirmSubmit>`
    expect(confirmationSites(source)).toEqual([
      { component: "ConfirmSubmit", hasPreview: true, destructive: true },
    ])
  })

  it("treats ConfirmSubmit as destructive by default and ConfirmDialog as not", () => {
    expect(confirmationSites(`<ConfirmSubmit action={a} title="t">x</ConfirmSubmit>`)).toEqual([
      { component: "ConfirmSubmit", hasPreview: false, destructive: true },
    ])
    expect(confirmationSites(`<ConfirmSubmit variant="primary" title="t">x</ConfirmSubmit>`)).toEqual([
      { component: "ConfirmSubmit", hasPreview: false, destructive: false },
    ])
    expect(confirmationSites(`<ConfirmDialog isOpen={o} title="t" />`)).toEqual([
      { component: "ConfirmDialog", hasPreview: false, destructive: false },
    ])
    expect(confirmationSites(`<ConfirmDialog isOpen={o} variant="danger" title="t" />`)).toEqual([
      { component: "ConfirmDialog", hasPreview: false, destructive: true },
    ])
  })

  it("does not mistake the component's own definition or an import for a call site", () => {
    expect(confirmationSites(`import { ConfirmDialog } from "@/components/ui/ConfirmDialog"`)).toEqual(
      [],
    )
    expect(confirmationSites(`export function ConfirmDialog(props: ConfirmDialogProps) {}`)).toEqual([])
  })
})

describe("the standard, measured against the product", () => {
  /** file → its confirmation sites, for every module that has any. */
  function sitesByFile(): Map<string, ReturnType<typeof confirmationSites>> {
    const out = new Map<string, ReturnType<typeof confirmationSites>>()
    for (const file of productModules()) {
      const relative = path.relative(APP_ROOT, file).split(path.sep).join("/")
      // The primitive itself renders ConfirmDialog; it is the implementation,
      // not a surface that has to disclose anything.
      if (relative === "src/components/ui/ConfirmDialog.tsx") continue
      const sites = confirmationSites(fs.readFileSync(file, "utf8"))
      if (sites.length > 0) out.set(relative, sites)
    }
    return out
  }

  it("has at least one migrated surface, and it is the seat deletion", () => {
    // A standard with no adopter is a proposal. This is the one that shipped.
    const sites = sitesByFile().get("src/app/(app)/admin/clubs/[slug]/page.tsx")
    expect(sites).toBeDefined()
    expect(sites!.some((s) => s.destructive && s.hasPreview)).toBe(true)
  })

  it("counts every unmigrated destructive confirmation against the register", () => {
    // One assertion, both directions: a NEW destructive dialog without a preview
    // fails (its file is absent, or its count is now higher than the register
    // says), and a surface that migrates fails too until the register is
    // lowered. The register cannot rot in either direction.
    const expected = new Map(DESTRUCTIVE_PREVIEW_BACKLOG.map((b) => [b.file, b.unmigrated]))
    const actual: [string, number][] = []
    for (const [file, sites] of sitesByFile()) {
      const unmigrated = sites.filter((s) => s.destructive && !s.hasPreview).length
      if (unmigrated > 0 || expected.has(file)) actual.push([file, unmigrated])
    }
    expect(new Map(actual)).toEqual(expected)
  })

  it("keeps every register entry pointed at a file that still has confirmations", () => {
    const files = sitesByFile()
    for (const entry of DESTRUCTIVE_PREVIEW_BACKLOG) {
      expect({ file: entry.file, present: files.has(entry.file) }).toEqual({
        file: entry.file,
        present: true,
      })
      // A reason short enough to be a shrug is not a reason.
      expect(entry.reason.length).toBeGreaterThan(60)
    }
  })
})
