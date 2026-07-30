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
        },
        text: {
          1: "var(--text-1)",
          2: "var(--text-2)",
          3: "var(--text-3)",
          disabled: "var(--text-disabled)",
          link: "var(--text-link)",
        },
        status: {
          success: "var(--success)",
          warning: "var(--warning)",
          error: "var(--error)",
          info: "var(--info)",
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
      },
      width: {
        sidenav: "var(--sidenav-width)",
        "sidenav-collapsed": "var(--sidenav-width-collapsed)",
        "sidenav-current": "var(--sidenav-current-width)",
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
