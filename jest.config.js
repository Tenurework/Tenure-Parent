const nextJest = require("next/jest.js")

const createJestConfig = nextJest({ dir: "./" })

/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  // scripts/ ships as ESM .mjs into the runtime image; its logic is testable too
  moduleFileExtensions: ["js", "jsx", "ts", "tsx", "mjs", "json", "node"],
  testMatch: ["**/__tests__/**/*.[jt]s?(x)", "**/?(*.)+(spec|test).?([mc])[jt]s?(x)"],
  // e2e/ belongs to Playwright, not Jest
  testPathIgnorePatterns: ["/node_modules/", "/.next/", "/e2e/"],
}

module.exports = createJestConfig(config)
