/**
 * Theme constants shared by a server component and a client one.
 *
 * Deliberately NOT in `ThemeToggle.tsx`. That file is `"use client"`, and a
 * non-component value exported from a client module does not survive being
 * imported by a server component — Next replaces the module's exports with
 * client references, so `THEME_STORAGE_KEY` arrived in the root layout as
 * `undefined` and the pre-paint script serialised to
 * `localStorage.getItem(undefined)`.
 *
 * Nothing threw. The script ran, read nothing, and every operator got the light
 * theme regardless of what they had chosen — a bug that reads as "the toggle
 * does not stick" and points nowhere near its cause. It was caught by grepping
 * the served HTML for the key, which is why the e2e asserts on the rendered
 * document rather than on the component.
 */

export type ColorScheme = "system" | "light" | "dark"

export const THEME_STORAGE_KEY = "tenure-studio-theme"

/**
 * The pre-paint script, as source.
 *
 * Runs before the browser paints, which React cannot do: the earliest it could
 * stamp the attribute is after hydration, and by then the light page is already
 * on screen. That gap is the flash.
 *
 * Kept tiny and dependency-free because it is inlined and blocking.
 */
export const NO_FLASH_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var scheme = stored === "light" || stored === "dark" ? stored : "system";
    var dark = scheme === "dark" ||
      (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.setAttribute("data-theme", "dark");
  } catch (e) {
    /* Private mode denies localStorage. Falling through leaves the light
       default, which is a theme nobody chose and not a broken page. */
  }
})();
`
