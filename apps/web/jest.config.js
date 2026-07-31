const nextJest = require("next/jest.js")

// `dir` is resolved against process.cwd(), not against this file. Anchoring it
// on __dirname keeps next/jest loading THIS app's next.config.ts even when jest
// is launched from the monorepo root (a root `projects` config, an IDE runner).
const createJestConfig = nextJest({ dir: __dirname })

/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
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
