const nextJest = require("next/jest.js")

// `dir` is resolved against process.cwd(), not against this file. Anchoring it
// on __dirname keeps next/jest loading THIS app's next.config.ts even when jest
// is launched from the monorepo root (a root `projects` config, an IDE runner).
const createJestConfig = nextJest({ dir: __dirname })

/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  // Platform packages are TypeScript source consumed without a build step, so
  // their tests run through this app's next/jest transform rather than needing
  // a second toolchain per package. Listing the roots explicitly (rather than
  // leaving rootDir to imply one) is what lets a file outside apps/web be
  // collected at all.
  roots: ["<rootDir>/src", "<rootDir>/scripts", "<rootDir>/../../packages"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@tenure/configuration$": "<rootDir>/../../packages/configuration/src/index.ts",
    "^@tenure/blueprints$": "<rootDir>/../../blueprints/index.ts",
  },
  // scripts/ ships as ESM .mjs into the runtime image; its logic is testable too
  moduleFileExtensions: ["js", "jsx", "ts", "tsx", "mjs", "json", "node"],
  testMatch: ["**/__tests__/**/*.[jt]s?(x)", "**/?(*.)+(spec|test).?([mc])[jt]s?(x)"],
  // e2e/ belongs to Playwright, not Jest.
  // *.itest.ts needs a live PostgreSQL, so it is excluded from the default run
  // and executed by `npm run test:isolation` (CI runs it in the Migrations job,
  // which already has a database).
  testPathIgnorePatterns: ["/node_modules/", "/.next/", "/e2e/", "\\.itest\\.ts$"],
}

module.exports = createJestConfig(config)
