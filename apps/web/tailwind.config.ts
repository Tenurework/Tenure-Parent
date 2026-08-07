import path from "node:path"
import type { Config } from "tailwindcss"

const config: Config = {
  // Anchored on this file, not on process.cwd(). Tailwind resolves relative
  // content globs against the cwd of whatever launched the build; from the
  // monorepo root they would match zero files and Tailwind would emit base +
  // preflight only. Nothing errors in that case — the image builds, the health
  // check passes, and production renders unstyled. path.join(__dirname, ...)
  // removes the failure mode. (Tailwind 3.4 loads .ts configs via jiti, which
  // provides __dirname.)
  content: [
    path.join(__dirname, "src/pages/**/*.{js,ts,jsx,tsx,mdx}"),
    path.join(__dirname, "src/components/**/*.{js,ts,jsx,tsx,mdx}"),
    path.join(__dirname, "src/app/**/*.{js,ts,jsx,tsx,mdx}"),
  ],
  theme: {
    extend: {
      colors: {
        shell: {
          DEFAULT: "var(--shell-bg)",
          text: "var(--shell-text)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          hover: "var(--primary-hover)",
          light: "var(--primary-light)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          light: "var(--accent-light)",
          strong: "var(--accent-strong)",
        },
        surface: "var(--bg-surface)",
        base: "var(--bg-base)",
        subtle: "var(--bg-subtle)",
        border: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
          // The 3:1 edge for anything whose boundary IS its affordance — inputs,
          // selects, checkboxes. `border-strong` is a decorative hairline and
          // does not clear 1.4.11; see the GE-022-003 contrast audit.
          control: "var(--border-control)",
        },
        text: {
          1: "var(--text-1)",
          2: "var(--text-2)",
          3: "var(--text-3)",
          disabled: "var(--text-disabled)",
          link: "var(--text-link)",
        },
        status: {
          // The base hue is a FILL (1.4.11, 3:1). Words go in the -text step,
          // which clears 4.5:1 on every surface — see the GE-022-003 audit.
          success: "var(--success)",
          "success-text": "var(--success-text)",
          warning: "var(--warning)",
          "warning-text": "var(--warning-text)",
          error: "var(--error)",
          "error-text": "var(--error-text)",
          info: "var(--info)",
          "info-text": "var(--info-text)",
        },
        chart: {
          1: "var(--chart-1)",
          2: "var(--chart-2)",
          3: "var(--chart-3)",
          4: "var(--chart-4)",
          5: "var(--chart-5)",
          6: "var(--chart-6)",
          7: "var(--chart-7)",
          8: "var(--chart-8)",
          grid: "var(--chart-grid)",
          axis: "var(--chart-axis)",
        },
      },
      height: {
        shell: "var(--shell-height)",
        footer: "var(--footer-height)",
        // Density contract (globals.css --control-h* / --row-h). Comfortable
        // resolves to exactly the h-8 / h-10 / h-11 these replaced, so binding
        // them changed nothing; compact is what they now make possible.
        "control-sm": "var(--control-h-sm)",
        control: "var(--control-h)",
        "control-lg": "var(--control-h-lg)",
        row: "var(--row-h)",
      },
      width: {
        sidenav: "var(--sidenav-width)",
        "sidenav-collapsed": "var(--sidenav-width-collapsed)",
        "sidenav-current": "var(--sidenav-current-width)",
        // Square icon buttons have to follow the height, or compact makes them
        // rectangles.
        control: "var(--control-h)",
      },
      // ─── The z-layer contract (globals.css --z-*) ────────────────────────
      // `extend`, so Tailwind's numeric z-0…z-50 still resolve — but
      // eslint.config.mjs's arbitraryZIndex rule rejects those and z-[…] alike,
      // which is what makes these the only way to layer something. Deleting
      // this block does not break the lint message (that is generated from
      // globals.css); it breaks the classes the message names, and
      // src/app/design-contracts.test.ts fails on exactly that.
      zIndex: {
        raised: "var(--z-raised)",
        marker: "var(--z-marker)",
        dragged: "var(--z-dragged)",
        popover: "var(--z-popover)",
        sticky: "var(--z-sticky)",
        scrim: "var(--z-scrim)",
        nav: "var(--z-nav)",
        header: "var(--z-header)",
        "chrome-popover": "var(--z-chrome-popover)",
        "assist-scrim": "var(--z-assist-scrim)",
        assist: "var(--z-assist)",
        toast: "var(--z-toast)",
        overlay: "var(--z-overlay)",
        "skip-link": "var(--z-skip-link)",
      },
      // ─── The motion contract (globals.css --motion-* / --ease-*) ─────────
      transitionDuration: {
        fast: "var(--motion-fast)",
        base: "var(--motion-base)",
        slow: "var(--motion-slow)",
      },
      transitionTimingFunction: {
        entry: "var(--ease-entry)",
        exit: "var(--ease-exit)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-display-face)", "var(--font-inter)", "system-ui", "sans-serif"],
      },
      fontSize: {
        meta: "var(--step-00)",
        lead: "var(--step-1)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius-md)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-md)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
    },
  },
  plugins: [],
}

export default config
