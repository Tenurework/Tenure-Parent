import { test, expect, type Page } from "@playwright/test"
import fs from "fs"
import path from "path"

import { operatorFor } from "./operator-identity"

import {
  DEFAULT_PREFERENCES,
  STORAGE_KEYS,
  documentAttributes,
  preferenceStore,
  readPreference,
  resolveAccessibility,
  resolveColorScheme,
  writePreference,
  type Density,
  type PreferenceStore,
  type Preferences,
} from "../src/lib/preferences"

/**
 * GE-022-008 — the resolution rules, with no browser.
 *
 * These use Playwright as a plain test runner because they need no page. The
 * Studio has no unit-test toolchain, and adding jest for four pure functions
 * would mean a second transform, a second config and a second thing to keep in
 * step with `tsconfig.json` — a worse trade than an unusual home for a fast
 * test. The browser tests in `preferences.spec.ts` cover what a page is needed
 * for, which is everything that can be broken by CSS.
 *
 * ## STUDIO-030-005 is at the bottom of this file, and it needs a page
 *
 * "Implement comfortable and compact density modes without information loss,
 * and persist only as operator preference."
 *
 * The first clause is not a property of a function. Information loss is a
 * property of the rendered document — a column that stopped being displayed, a
 * row that no longer draws, a value cut off by an ellipsis with no full text
 * anywhere — so the proof of it reads the DOM in both densities and compares
 * the two. It lives here rather than in `preferences.spec.ts` because this file
 * is where the density contract is pinned, and the two halves of one
 * requirement being in one file is worth more than the file's name being
 * literally true.
 */

const device = (over: Partial<{ dark: boolean; reducedMotion: boolean; increasedContrast: boolean }> = {}) => ({
  dark: false,
  reducedMotion: false,
  increasedContrast: false,
  ...over,
})

test.describe("accessibility preferences: the device is a floor, not a default", () => {
  // This is the load-bearing rule of the whole item. Bible §26.5 says settings
  // "can be overridden by device accessibility preferences" — so a person whose
  // operating system asks for reduced motion gets it whatever this console's
  // own control says. `prefers-reduced-motion` is commonly set for vestibular
  // disorders, and a product where a stray click re-enables animation has
  // turned a medical accommodation into a preference.

  test("the device asking is enough, whatever the stored value", () => {
    for (const stored of ["system", "on", "off"] as const) {
      expect(resolveAccessibility(stored, true)).toBe(true)
    }
  })

  test("the user asking is enough, whatever the device says", () => {
    expect(resolveAccessibility("on", false)).toBe(true)
  })

  test("off and system are the same when the device is silent", () => {
    // Both mean "no". They are distinct values so the UI can show which of the
    // two a person chose, not so they can resolve differently.
    expect(resolveAccessibility("off", false)).toBe(false)
    expect(resolveAccessibility("system", false)).toBe(false)
  })

  test("there is no way to express 'never'", () => {
    // If some future value could suppress a device request, this rule stops
    // being a floor. The type has three values and none of them can.
    const everyOutcomeWhenDeviceAsks = (["system", "on", "off"] as const).map((p) =>
      resolveAccessibility(p, true),
    )
    expect(everyOutcomeWhenDeviceAsks).toEqual([true, true, true])
  })
})

test.describe("colour scheme is taste: an explicit choice beats the machine", () => {
  test("light on a dark machine stays light", () => {
    // The asymmetry with the rule above, and it is deliberate. A person who
    // picked light on a dark-mode laptop meant it; nobody's health depends on
    // the outcome.
    expect(resolveColorScheme("light", true)).toBe(false)
  })

  test("dark on a light machine stays dark", () => {
    expect(resolveColorScheme("dark", false)).toBe(true)
  })

  test("system follows the machine both ways", () => {
    expect(resolveColorScheme("system", true)).toBe(true)
    expect(resolveColorScheme("system", false)).toBe(false)
  })
})

test.describe("document attributes", () => {
  test("defaults set nothing at all", () => {
    // Light, comfortable, full motion and normal contrast are the CSS defaults,
    // so there is exactly one place each state can come from. An attribute
    // spelling out the default would be a second source to disagree with it.
    expect(documentAttributes(DEFAULT_PREFERENCES, device())).toEqual({
      "data-theme": null,
      "data-density": null,
      "data-motion": null,
      "data-contrast": null,
      // `ltr` is the served default, so the script writes nothing for it.
      dir: null,
    })
  })

  test("a silent device plus explicit choices sets all four", () => {
    const chosen: Preferences = {
      colorScheme: "dark",
      density: "compact",
      reducedMotion: "on",
      increasedContrast: "on",
      direction: "ltr",
    }
    expect(documentAttributes(chosen, device())).toEqual({
      "data-theme": "dark",
      "data-density": "compact",
      "data-motion": "reduced",
      "data-contrast": "more",
      dir: null,
    })
  })

  test("direction is the only attribute that is not a data- hook", () => {
    // STUDIO-030-007. `dir` is a real HTML attribute because the layout engine
    // keys on it: every `margin-inline-start` in globals.css resolves against
    // it, and a `data-direction` would set nothing at all.
    expect(
      documentAttributes({ ...DEFAULT_PREFERENCES, direction: "rtl" }, device()).dir,
    ).toBe("rtl")
    expect(documentAttributes(DEFAULT_PREFERENCES, device()).dir).toBeNull()
  })

  test("a device asking for accessibility sets those two from defaults alone", () => {
    expect(
      documentAttributes(DEFAULT_PREFERENCES, device({ reducedMotion: true, increasedContrast: true })),
    ).toMatchObject({ "data-motion": "reduced", "data-contrast": "more" })
  })

  test("density never follows the device, because no device reports one", () => {
    // Guards against someone later wiring density to a media query that does
    // not mean what it looks like.
    expect(
      documentAttributes(DEFAULT_PREFERENCES, device({ dark: true, reducedMotion: true, increasedContrast: true }))[
        "data-density"
      ],
    ).toBeNull()
  })
})

/**
 * STUDIO-030-005, second clause — "persist only as operator preference".
 *
 * The store is the operator's own device and nothing else, which makes it
 * fallible in a way a server-side record is not: a browser blocking site data
 * THROWS on the property access rather than returning null. These drive that
 * with a store that refuses, because a browser cannot be persuaded to.
 */
test.describe("the preference store is fallible, and a denied one costs only the memory", () => {
  const throwing: PreferenceStore = {
    getItem() {
      throw new DOMException("The operation is insecure.", "SecurityError")
    },
    setItem() {
      throw new DOMException("The operation is insecure.", "SecurityError")
    },
  }

  test("a host whose localStorage getter throws resolves to no store", () => {
    // Safari private browsing and Chrome with site data blocked. This is the
    // access that unmounted the masthead: `PreferencesMenu`'s mount effect read
    // `window.localStorage` directly, and an exception out of an effect takes
    // the tree with it — on every route, because the menu is in the masthead.
    const host = {
      get localStorage(): PreferenceStore {
        throw new DOMException("The operation is insecure.", "SecurityError")
      },
    }
    expect(preferenceStore(host)).toBeNull()
  })

  test("a store that exists but throws on use also resolves to no store", () => {
    // The other half: some browsers hand over the object and refuse the call.
    // Probed with a READ, so nothing is left behind on a store that works.
    expect(preferenceStore({ localStorage: throwing })).toBeNull()
  })

  test("a working store is returned as itself", () => {
    const working: PreferenceStore = { getItem: () => null, setItem: () => {} }
    expect(preferenceStore({ localStorage: working })).toBe(working)
  })

  test("reading through a denied store is the default, not an exception", () => {
    expect(readPreference(null, STORAGE_KEYS.density, ["comfortable", "compact"], "comfortable")).toBe(
      "comfortable",
    )
    expect(
      readPreference(throwing, STORAGE_KEYS.density, ["comfortable", "compact"], "comfortable"),
    ).toBe("comfortable")
  })

  test("a value nobody defined is the default", () => {
    // The keys are editable by anyone with devtools. An unrecognised value must
    // not reach the document, because the stylesheet has no rules for it.
    const rogue: PreferenceStore = { getItem: () => "cosy", setItem: () => {} }
    expect(readPreference(rogue, STORAGE_KEYS.density, ["comfortable", "compact"], "comfortable")).toBe(
      "comfortable",
    )
  })

  test("a stored value that IS defined comes back", () => {
    const stored: PreferenceStore = { getItem: () => "compact", setItem: () => {} }
    expect(readPreference(stored, STORAGE_KEYS.density, ["comfortable", "compact"], "comfortable")).toBe(
      "compact",
    )
  })

  test("a refused write is reported, not thrown", () => {
    // It is raised in an event handler, where React escalates an exception to
    // the error boundary. The choice still applies for the tab; only its memory
    // is lost, and the menu says so.
    expect(writePreference(throwing, STORAGE_KEYS.density, "compact")).toBe(false)
    expect(writePreference(null, STORAGE_KEYS.density, "compact")).toBe(false)
  })

  test("a write that lands is reported as landed, with the key and value it was given", () => {
    const written: [string, string][] = []
    const working: PreferenceStore = {
      getItem: () => null,
      setItem: (key, value) => {
        written.push([key, value])
      },
    }
    expect(writePreference(working, STORAGE_KEYS.density, "compact")).toBe(true)
    expect(written).toEqual([[STORAGE_KEYS.density, "compact"]])
  })
})

/**
 * STUDIO-030-005, second clause again — this time as a property of the
 * REPOSITORY, because "persist only as operator preference" is a statement
 * about every module, not only about the one that writes the preference.
 */
const STUDIO_SRC = path.join(__dirname, "..", "src")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

test.describe("density is stored on the operator's device and nowhere else", () => {
  test("the density key appears in exactly one module", () => {
    // `preferences.ts` declares it; `PreferencesMenu` reaches it through
    // `STORAGE_KEYS`. A second literal is how a copy of this preference ends up
    // somewhere the first one is not.
    const carriers = sourceFiles(STUDIO_SRC)
      .filter((file) => fs.readFileSync(file, "utf8").includes(STORAGE_KEYS.density))
      .map((file) => path.relative(STUDIO_SRC, file).replace(/\\/g, "/"))
    expect(carriers).toEqual(["lib/preferences.ts"])
  })

  test("nothing that writes to AWS or the registry mentions a density", () => {
    // The clause names the boundary rather than a file, so this looks for the
    // boundary: every module that can put a record somewhere durable. A density
    // field in one of these is the failure — a per-operator display choice
    // written into a record that belongs to a tenant.
    const WRITES = /\b(PutCommand|UpdateCommand|DeleteCommand|TransactWriteCommand|putAuditEntry|TENANT_TABLE)\b/
    const writers = sourceFiles(STUDIO_SRC).filter((file) => {
      if (/\.(test|itest)\.tsx?$/.test(file)) return false
      return WRITES.test(fs.readFileSync(file, "utf8"))
    })
    expect(writers.length, "no writer modules found — the scan is looking at nothing").toBeGreaterThan(3)

    const offenders = writers
      .filter((file) => /density/i.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(STUDIO_SRC, file).replace(/\\/g, "/"))
    expect(offenders).toEqual([])
  })

  test("the preference is not a cookie, because a cookie is sent to the server", () => {
    // The distinction the clause turns on. `document.cookie` and `Set-Cookie`
    // both put a per-operator display choice into every request; localStorage
    // does not. Asserted on the module that owns the preference rather than on
    // a running page, because the absence of a thing is what is being claimed.
    const owned = [
      path.join(STUDIO_SRC, "lib", "preferences.ts"),
      path.join(STUDIO_SRC, "components", "PreferencesMenu.tsx"),
    ]
    for (const file of owned) {
      const source = fs.readFileSync(file, "utf8")
      // Comments say the word on purpose — the rule is about code.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      expect(code, `${path.basename(file)} touches document.cookie`).not.toMatch(/document\s*\.\s*cookie/)
      expect(code, `${path.basename(file)} sets a cookie`).not.toMatch(/Set-Cookie|cookies\(\)/)
      expect(code, `${path.basename(file)} sends the preference somewhere`).not.toMatch(
        /\bfetch\s*\(|XMLHttpRequest|sendBeacon|navigator\s*\.\s*sendBeacon/,
      )
    }
  })
})

/**
 * ── STUDIO-030-005, first clause: "without information loss" ────────────────
 *
 * The half of the item that had no test. `data-density` demonstrably reaches
 * the document and demonstrably tightens spacing — `preferences.spec.ts` pins
 * both — but nothing anywhere asserted that the two densities show the same
 * FACTS. A compact mode that drops a column, hides a row or clips a value is a
 * compact mode that lies, and every existing assertion about density would
 * still be green.
 *
 * So: render a dense surface, read everything an operator can see, switch
 * density through the real control, read it again, and require the two to be
 * the same set of facts with different geometry.
 */
const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForLoadState("networkidle")
  // The click settles on /api/auth/callback/operator, which returns no HTML.
  await page.goto("/")
  await page.waitForLoadState("networkidle")
}

/** Through the control an operator uses, then closed again so the panel is not part of the reading. */
async function chooseDensity(page: Page, density: Density) {
  const panel = page.locator(".pref-panel")
  if (!(await panel.isVisible())) await page.locator(".pref-trigger").click()
  await page.locator(`[name="density"][value="${density}"]`).check()
  await page.keyboard.press("Escape")
  await expect(panel).toBeHidden()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-density")))
    .toBe(density === "compact" ? "compact" : null)
}

/**
 * Everything the surface is telling the operator, and the geometry it uses.
 *
 * Read from `<main>`: the masthead carries the control being operated, and a
 * panel that was open a moment ago is not a fact about the page.
 *
 * `text` is VISIBLE text — `textContent` alone would report the contents of a
 * `display: none` column happily, which is the exact failure this is looking
 * for. `clipped` is the other failure: text that is present in the DOM, cut off
 * on screen by an overflow that hides it, and therefore lost to a reader unless
 * the full value is on a `title` or an `aria-label`.
 */
interface SurfaceFacts {
  tables: { caption: string; headers: string[]; rows: string[][] }[]
  hiddenCells: string[]
  text: string[]
  interactive: string[]
  clipped: { id: string; labelled: boolean }[]
  geometry: { contentHeight: number; paddingTop: number; rowHeight: number | null }
}

async function factsOf(page: Page): Promise<SurfaceFacts> {
  return page.evaluate(() => {
    const root = document.querySelector("main")
    if (!root) throw new Error("this route has no <main> to read")
    const squash = (value: string) => value.replace(/\s+/g, " ").trim()

    const drawn = (el: Element) => {
      const style = getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false
      const box = el.getBoundingClientRect()
      return box.width > 0 || box.height > 0
    }
    const shown = (el: Element) => {
      let node: Element | null = el
      while (node && node !== root.parentElement) {
        if (!drawn(node)) return false
        node = node.parentElement
      }
      return true
    }

    const all = Array.from(root.querySelectorAll("*"))

    const text: string[] = []
    for (const el of all) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => squash(n.textContent ?? ""))
        .filter(Boolean)
        .join(" ")
      if (!own) continue
      if (!shown(el)) continue
      text.push(own)
    }

    const tables = Array.from(root.querySelectorAll("table"))
      .filter(shown)
      .map((table) => ({
        caption: squash(table.querySelector("caption")?.textContent ?? ""),
        headers: Array.from(table.querySelectorAll("thead th")).map((th) => squash(th.textContent ?? "")),
        rows: Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr")).map((tr) =>
          Array.from(tr.cells).map((cell) => squash(cell.textContent ?? "")),
        ),
      }))

    // A cell whose text `textContent` still reports and the operator cannot
    // see. Collected separately because the table reading above cannot tell.
    const hiddenCells = Array.from(root.querySelectorAll("th, td"))
      .filter((cell) => !shown(cell))
      .map((cell) => `${cell.tagName.toLowerCase()} "${squash(cell.textContent ?? "").slice(0, 40)}"`)

    const interactive = Array.from(root.querySelectorAll("a, button, input, select, summary"))
      .filter(shown)
      .map((el) => {
        const label =
          el.getAttribute("aria-label") ||
          squash(el.textContent ?? "") ||
          el.getAttribute("value") ||
          el.getAttribute("name") ||
          "-"
        return `${el.tagName.toLowerCase()}:${label}`
      })

    const clipped: { id: string; labelled: boolean }[] = []
    for (const el of all) {
      if (!shown(el)) continue
      const style = getComputedStyle(el)
      const cuts = (axis: string) => axis === "hidden" || axis === "clip"
      const cut =
        (cuts(style.overflowX) && el.scrollWidth > el.clientWidth + 1) ||
        (cuts(style.overflowY) && el.scrollHeight > el.clientHeight + 1)
      if (!cut) continue
      const own = squash(el.textContent ?? "")
      if (!own) continue
      clipped.push({
        id: `${el.tagName.toLowerCase()}.${(el.className || "-").toString().split(" ")[0]} "${own.slice(0, 40)}"`,
        labelled: Boolean(el.getAttribute("title") || el.getAttribute("aria-label")),
      })
    }

    const firstRow = root.querySelector("tbody tr")
    return {
      tables,
      hiddenCells,
      text,
      interactive,
      clipped,
      geometry: {
        contentHeight: root.scrollHeight,
        paddingTop: parseFloat(getComputedStyle(root).paddingTop),
        rowHeight: firstRow ? firstRow.getBoundingClientRect().height : null,
      },
    }
  })
}

/**
 * Surfaces chosen for what they carry, not for coverage: the fleet is the
 * densest table in the console, `/platform` is the widest spread of cards and
 * key/value blocks, and `/` is the index every operator lands on.
 */
const DENSE_ROUTES = ["/tenants", "/platform", "/"]

test.describe("compact changes the geometry and nothing else", () => {
  test.beforeAll(() => {
    expect(OPERATOR, "PLATFORM_OPERATORS must be set").not.toBe("")
    expect(SECRET, "PLATFORM_OPERATOR_SECRET must be set").not.toBe("")
  })

  for (const route of DENSE_ROUTES) {
    test(`${route} shows the same facts in both densities`, async ({ page }) => {
      await signIn(page)
      await page.goto(route)
      await page.waitForLoadState("networkidle")

      await chooseDensity(page, "comfortable")
      const comfortable = await factsOf(page)
      // Reading an empty page and finding it identical to another empty page
      // proves nothing. This is the surface having something to lose.
      expect(comfortable.text.length, `${route} renders almost nothing`).toBeGreaterThan(20)

      // No reload between the two readings, deliberately: a navigation would
      // re-render the server component and any freshness or duration on the
      // page would legitimately differ, so a difference would no longer mean
      // what this test says it means. Density is a document attribute, and the
      // attribute is the only thing that changes here.
      await chooseDensity(page, "compact")
      const compact = await factsOf(page)

      expect(compact.tables, `${route}: a table lost a column, a row or a value`).toEqual(
        comfortable.tables,
      )
      expect(compact.hiddenCells, `${route}: compact hid a cell`).toEqual(comfortable.hiddenCells)
      expect(compact.text, `${route}: compact dropped or changed visible text`).toEqual(
        comfortable.text,
      )
      expect(compact.interactive, `${route}: compact removed a control`).toEqual(
        comfortable.interactive,
      )

      // The other half of "without information loss": text still in the DOM,
      // cut off on screen, with no full value on a title or an aria-label. A
      // value an operator cannot read is lost whether or not it is present.
      const newlyCut = compact.clipped.filter(
        (c) => !c.labelled && !comfortable.clipped.some((was) => was.id === c.id),
      )
      expect(newlyCut, `${route}: compact truncated a value with no full text anywhere`).toEqual([])

      // And it has to actually be denser, or the two modes are one mode and
      // everything above is trivially true.
      expect(compact.geometry.paddingTop, `${route}: compact did not tighten`).toBeLessThan(
        comfortable.geometry.paddingTop,
      )
      expect(compact.geometry.contentHeight, `${route}: compact fits no more on a screen`).toBeLessThan(
        comfortable.geometry.contentHeight,
      )
    })
  }

  test("no density leaves the browser when it is chosen", async ({ page }) => {
    // "Persist only as operator preference", measured rather than argued. Every
    // request the page makes while the preference is being changed is read: a
    // density that reached a route handler, an action or an analytics beacon
    // would appear here as a URL or a body carrying the word.
    await signIn(page)
    await page.goto("/tenants")
    await page.waitForLoadState("networkidle")

    const carried: string[] = []
    page.on("request", (request) => {
      const body = request.postData() ?? ""
      if (/density|comfortable|compact/i.test(request.url() + " " + body)) {
        carried.push(`${request.method()} ${request.url()} ${body.slice(0, 120)}`)
      }
    })

    await chooseDensity(page, "compact")
    await chooseDensity(page, "comfortable")
    await chooseDensity(page, "compact")
    await page.waitForTimeout(500)

    expect(carried, "the density preference was sent to the server").toEqual([])

    // Nor is it in anything the server WILL receive on the next request.
    const cookies = await page.context().cookies()
    expect(
      cookies.filter((c) => /density|comfortable|compact/i.test(`${c.name} ${c.value}`)),
      "the density preference is in a cookie, which is sent on every request",
    ).toEqual([])

    // It is exactly where it is supposed to be, and that is the whole store.
    expect(
      await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEYS.density),
    ).toBe("compact")
  })

  test("the server renders the same document whichever density the operator chose", async ({ page }) => {
    // If the server knew, it would say so in the markup. It does not know: the
    // attribute is written by the pre-paint script from the operator's own
    // store, which is what makes the preference theirs alone.
    await signIn(page)
    const htmlTag = async () => {
      const body = await (await page.request.get("/tenants")).text()
      return body.slice(body.indexOf("<html"), body.indexOf(">", body.indexOf("<html")) + 1)
    }

    await chooseDensity(page, "comfortable")
    const before = await htmlTag()
    await chooseDensity(page, "compact")
    const after = await htmlTag()

    expect(before).not.toContain("data-density")
    expect(after, "the server rendered a density it could only have got from a stored record").toBe(
      before,
    )
  })

  test("a browser that denies storage still renders the console and still switches density", async ({
    page,
  }) => {
    // The store is fallible because it is the operator's own device. Denying it
    // used to unmount the masthead on every route — `PreferencesMenu`'s mount
    // effect read `window.localStorage` directly, and an exception out of an
    // effect takes the tree with it.
    await signIn(page)
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("The operation is insecure.", "SecurityError")
        },
      })
    })
    await page.goto("/tenants")
    await page.waitForLoadState("networkidle")

    // The console is still there.
    await expect(page.locator(".pref-trigger")).toBeVisible()
    await expect(page.locator("main")).toBeVisible()

    // And the choice still applies for this tab, which is all a denied store
    // can cost. The panel says so rather than pretending it was saved.
    await page.locator(".pref-trigger").click()
    await page.locator('[name="density"][value="compact"]').check()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-density")))
      .toBe("compact")
    await expect(page.getByText("apply to this tab only")).toBeVisible()
  })
})
