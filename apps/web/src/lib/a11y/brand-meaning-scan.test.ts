/**
 * GE-143-012 — the two shapes a review of the first pass found still live.
 *
 * The fixtures here are the SOURCE TEXT of the defects, quoted from the files
 * they were in, so a reader can see that the scan fires on the real thing rather
 * than on something shaped like it. The three cases that read the shipped tree
 * are the ones that keep it fixed.
 */
import fs from "node:fs"
import path from "node:path"

import { BRAND_WRITABLE_PROPERTIES, PROTECTED_MEANINGS } from "./brand-roles"
import {
  PROTECTED_PREDICATES,
  linkMeaningOffenders,
  linksWithoutPlatformRest,
  predicateMeaningOffenders,
} from "./brand-meaning-scan"
import { ALL_THEMES, readThemes, token } from "./theme-tokens"

const APP_ROOT = path.resolve(__dirname, "../../..")

/** Every .ts/.tsx that ships, excluding tests. Same set as brand-roles.test.ts. */
function productModules(): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|itest)\.tsx?$/.test(entry.name))
        files.push(full)
    }
  }
  walk(path.join(APP_ROOT, "src/app"))
  walk(path.join(APP_ROOT, "src/components"))
  return files
}

function relative(file: string): string {
  return path.relative(APP_ROOT, file).split(path.sep).join("/")
}

describe("a condition that tests a protected meaning", () => {
  it("names a predicate for every meaning it claims to cover", () => {
    expect(PROTECTED_PREDICATES.map((p) => p.meaning)).toEqual([
      "financial polarity",
      "status",
      "permission",
      "data quality",
      "disabled",
    ])
    // Every meaning here is one the register already protects — this scan adds
    // a second way to reach the same list, not a second list.
    const registered = PROTECTED_MEANINGS.map((m) => m.meaning)
    for (const predicate of PROTECTED_PREDICATES) {
      expect(registered).toContain(predicate.meaning)
      expect(predicate.why.length).toBeGreaterThan(40)
    }
  })

  it("finds the ledger's sign, whose other branch is an ordinary text colour", () => {
    // src/components/finance/LedgerDrawer.tsx, verbatim as it shipped. The
    // detector GE-143-012 built cannot see this: it requires a PROTECTED token
    // opposite the accent, and `text-text-1` is not one.
    const source =
      'className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${\n' +
      '  e.amountCents < 0 ? "text-[--primary]" : "text-text-1"\n' +
      "}`}"
    expect(predicateMeaningOffenders(source)).toEqual([
      {
        meaning: "financial polarity",
        condition: "e.amountCents < 0",
        brandToken: "--primary",
        conditional: '? "text-[--primary]" : "text-text-1"',
      },
    ])
  })

  it("finds a status and a permission painted in the accent", () => {
    expect(
      predicateMeaningOffenders('const c = status === "APPROVED" ? "text-[--primary]" : "text-text-2"'),
    ).toHaveLength(1)
    expect(
      predicateMeaningOffenders('const c = canManage ? "text-[--primary-text]" : "text-text-3"'),
    ).toHaveLength(1)
  })

  it("does not flag the accent doing its declared job", () => {
    // SideNav: the active item. "Which page am I on" is navigation, which is
    // exactly the role branding is allowed to occupy.
    expect(predicateMeaningOffenders('active ? "text-[--primary]" : "text-text-3"')).toEqual([])
    // A presence check on a money field is not a polarity test.
    expect(predicateMeaningOffenders('amountCents ? "text-[--primary]" : "text-text-1"')).toEqual([])
  })

  it("does not flag a permission deciding whether a control exists", () => {
    // Authorization removing a button is authorization working. Only a COLOUR
    // choice is this defect.
    expect(predicateMeaningOffenders("canManage ? <Button>Edit</Button> : null")).toEqual([])
  })

  it("does not flag a conditional between two shades of the accent", () => {
    expect(
      predicateMeaningOffenders('disabled ? "text-[--primary-light]" : "text-[--primary]"'),
    ).toEqual([])
  })

  it("leaves no protected-meaning predicate answered in the accent, anywhere in the tree", () => {
    const offenders: string[] = []
    for (const file of productModules()) {
      for (const offence of predicateMeaningOffenders(fs.readFileSync(file, "utf8"))) {
        offenders.push(
          `${relative(file)}: ${offence.meaning} — ${offence.condition} ${offence.conditional}`,
        )
      }
    }
    expect(offenders).toEqual([])
  })
})

describe("the link colour", () => {
  it("finds a link painted in the accent, in each of the three shapes that shipped", () => {
    const link = '<Link href="/approvals" className="text-[--primary] hover:underline">Open</Link>'
    const textButton =
      '<button className="text-xs font-medium text-[--primary] hover:underline">Invite</button>'
    // DocContentView: every anchor inside a document body.
    const documentBody = '<div className="prose-doc text-sm [&_a]:text-[--primary]" />'

    expect(linkMeaningOffenders(link)).toEqual([
      { element: "Link", brandToken: "--primary", classes: "text-[--primary] hover:underline" },
    ])
    expect(linkMeaningOffenders(textButton)).toHaveLength(1)
    expect(linkMeaningOffenders(documentBody)).toEqual([
      {
        element: "[&_a]",
        brandToken: "--primary",
        classes: "prose-doc text-sm [&_a]:text-[--primary]",
      },
    ])
  })

  it("reads a class list assembled in a template literal", () => {
    const source =
      '<Link href={href} className={`text-[--primary] ${compact ? "text-xs" : "text-sm"} hover:underline`}>x</Link>'
    expect(linkMeaningOffenders(source)).toHaveLength(1)
  })

  it("does not report a nested element twice, or under its parent's name", () => {
    // `<Attribute value={<Link className="…"/>} />` — the child lives inside the
    // parent's opening tag, and reading to `>` found the same class list twice.
    const source =
      '<Attribute label="Request" value={<Link href="/x" className="text-[--primary] hover:underline">r</Link>} />'
    expect(linkMeaningOffenders(source)).toEqual([
      { element: "Link", brandToken: "--primary", classes: "text-[--primary] hover:underline" },
    ])
  })

  it("does not flag an anchor styled as a button", () => {
    // DocumentViewerOverlay's download control: a border, a height, no underline.
    // The accent is in its declared primary-control role here.
    const source =
      '<a href={url} className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-[--primary] no-underline hover:bg-base">Download</a>'
    expect(linkMeaningOffenders(source)).toEqual([])
  })

  it("does not flag a link already on the platform's link token", () => {
    expect(
      linkMeaningOffenders('<Link className="text-[--text-link] hover:underline">x</Link>'),
    ).toEqual([])
  })

  it("does not flag a hover tint over a platform resting colour", () => {
    expect(
      linkMeaningOffenders(
        '<Link className="text-text-1 no-underline hover:text-[--primary]">x</Link>',
      ),
    ).toEqual([])
    expect(
      linksWithoutPlatformRest(
        '<Link className="text-text-1 no-underline hover:text-[--primary]">x</Link>',
      ),
    ).toEqual([])
  })

  it("does flag a link whose ONLY text colour is the accent on hover", () => {
    // The hole the exclusion above would otherwise open: no resting colour at
    // all, so the tenant's accent is the only thing that says "link".
    expect(
      linksWithoutPlatformRest('<Link className="font-medium hover:text-[--primary]">x</Link>'),
    ).toHaveLength(1)
  })

  it("leaves no link taking its resting colour from the accent, anywhere in the tree", () => {
    const offenders: string[] = []
    for (const file of productModules()) {
      for (const offence of linkMeaningOffenders(fs.readFileSync(file, "utf8"))) {
        offenders.push(`${relative(file)}: <${offence.element}> ${offence.brandToken} — ${offence.classes}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("leaves no link whose only text colour is the accent on hover", () => {
    const offenders: string[] = []
    for (const file of productModules()) {
      for (const offence of linksWithoutPlatformRest(fs.readFileSync(file, "utf8"))) {
        offenders.push(`${relative(file)}: <${offence.element}> ${offence.brandToken} — ${offence.classes}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("moves links onto a token branding cannot write, and that is a different colour", () => {
    // The fix would be cosmetic if --text-link were the accent under another
    // name, or if branding could set it.
    expect(BRAND_WRITABLE_PROPERTIES).not.toContain("--text-link")
    const themes = readThemes()
    for (const theme of ALL_THEMES) {
      const link = token(themes[theme], "--text-link")
      expect(link).not.toBe("")
      expect(link).not.toBe(token(themes[theme], "--primary"))
    }
  })
})
