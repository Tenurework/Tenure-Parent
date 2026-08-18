# Simon absorption — repository, package and module maps

**Generated** by `node tools/simon-absorption-inventory.mjs` from
`docs/architecture/simon-absorption-inventory.json`. Do not edit by hand — `tests/simon-absorption-inventory.test.mjs`
re-renders this file from the snapshot and reds on any difference.

Closes **SIMON-000-002**. Source repository read from `refs/remotes/live/main` only: the pilot is
never cloned, checked out or pushed to from here.

The complete file list for both sides lives in the snapshot JSON under
`source.files` and `target.files`; this document is the rolled-up view.
Every number here is a count of real tracked paths, and the guard test
checks the roll-ups add up to the file lists they came from.

## Module / area map

### Source

| Area | Tracked files |
| --- | ---: |
| `(repository root)` | 8 |
| `.github/workflows` | 12 |
| `Tier1` | 11 |
| `Tier1/extracted` | 11 |
| `apps/web` | 292 |
| `docs` | 3 |
| `docs/architecture` | 1 |
| `docs/decisions` | 5 |
| `infrastructure/terraform` | 20 |
| `packages` | 1 |
| **total** | **364** |

### Target

| Area | Tracked files |
| --- | ---: |
| `(repository root)` | 38 |
| `.github/workflows` | 19 |
| `Tier1` | 13 |
| `Tier1/extracted` | 11 |
| `apps/system-studio` | 388 |
| `apps/web` | 559 |
| `blueprints` | 5 |
| `blueprints/corporate-divisions` | 1 |
| `blueprints/nonprofit-program-operations` | 1 |
| `blueprints/university-student-organizations` | 1 |
| `docs` | 2 |
| `docs/architecture` | 69 |
| `docs/contracts` | 7 |
| `docs/decisions` | 15 |
| `docs/handoff` | 1 |
| `docs/implementation` | 23 |
| `docs/migrations` | 4 |
| `docs/payments` | 2 |
| `docs/runbooks` | 1 |
| `infrastructure/oidc` | 5 |
| `infrastructure/organization` | 7 |
| `infrastructure/studio` | 12 |
| `infrastructure/terraform` | 20 |
| `modules` | 2 |
| `packages` | 1 |
| `packages/audit` | 7 |
| `packages/authorization` | 24 |
| `packages/configuration` | 34 |
| `packages/contracts` | 3 |
| `packages/finops` | 19 |
| `packages/generality-fixtures` | 7 |
| `packages/identity` | 59 |
| `packages/metadata` | 5 |
| `packages/module-runtime` | 8 |
| `packages/organization-model` | 15 |
| `packages/payments` | 42 |
| `packages/platform-config` | 30 |
| `packages/provisioning` | 48 |
| `packages/releases` | 5 |
| `packages/workflow` | 5 |
| `tests` | 2 |
| `tests/architecture` | 97 |
| `tests/security` | 40 |
| `tools` | 61 |
| `tools/dev` | 4 |
| `tools/loop` | 58 |
| **total** | **1780** |

## Workspace and package map

### Source

| Manifest | Package | Private | Scripts | Depends on workspaces | External deps |
| --- | --- | ---: | ---: | --- | ---: |
| `apps/web/package.json` | `tenure` | yes | 9 | — | 32 |
| `package.json` | `tenure-parent` | yes | 10 | — | 0 |

### Target

| Manifest | Package | Private | Scripts | Depends on workspaces | External deps |
| --- | --- | ---: | ---: | --- | ---: |
| `apps/system-studio/package.json` | `@tenure/system-studio` | yes | 6 | `@tenure/audit` `@tenure/contracts` `@tenure/finops` `@tenure/provisioning` | 49 |
| `apps/web/package.json` | `tenure` | yes | 9 | `@tenure/contracts` | 30 |
| `blueprints/package.json` | `@tenure/blueprints` | yes | 0 | — | 0 |
| `modules/package.json` | `@tenure/modules` | yes | 0 | — | 0 |
| `package.json` | `tenure-parent` | yes | 18 | — | 1 |
| `packages/audit/package.json` | `@tenure/audit` | yes | 0 | — | 0 |
| `packages/authorization/package.json` | `@tenure/authorization` | yes | 0 | — | 0 |
| `packages/configuration/package.json` | `@tenure/configuration` | yes | 0 | `@tenure/audit` `@tenure/finops` | 1 |
| `packages/contracts/package.json` | `@tenure/contracts` | yes | 0 | — | 0 |
| `packages/finops/package.json` | `@tenure/finops` | yes | 0 | — | 0 |
| `packages/generality-fixtures/package.json` | `@tenure/generality-fixtures` | yes | 0 | — | 0 |
| `packages/identity/package.json` | `@tenure/identity` | yes | 0 | — | 0 |
| `packages/metadata/package.json` | `@tenure/metadata` | yes | 0 | — | 0 |
| `packages/module-runtime/package.json` | `@tenure/module-runtime` | yes | 0 | — | 0 |
| `packages/organization-model/package.json` | `@tenure/organization-model` | yes | 0 | — | 0 |
| `packages/payments/package.json` | `@tenure/payments` | yes | 0 | — | 0 |
| `packages/platform-config/package.json` | `@tenure/platform-config` | yes | 0 | — | 0 |
| `packages/provisioning/package.json` | `@tenure/provisioning` | yes | 0 | `@tenure/platform-config` | 0 |
| `packages/releases/package.json` | `@tenure/releases` | yes | 0 | — | 0 |
| `packages/workflow/package.json` | `@tenure/workflow` | yes | 0 | — | 0 |

## Dependency graphs

### Declared — workspace to workspace

### Source — workspace dependency graph

No workspace declares another workspace as a dependency.

### Target — workspace dependency graph

```
digraph workspaces {
  "@tenure/system-studio" -> "@tenure/audit"
  "@tenure/system-studio" -> "@tenure/contracts"
  "@tenure/system-studio" -> "@tenure/finops"
  "@tenure/system-studio" -> "@tenure/provisioning"
  "tenure" -> "@tenure/contracts"
  "@tenure/configuration" -> "@tenure/audit"
  "@tenure/configuration" -> "@tenure/finops"
  "@tenure/provisioning" -> "@tenure/platform-config"
}
```

### Observed — module imports, rolled up to areas

Derived from the import, export-from, dynamic `import()` and `require()`
specifiers in every tracked source file, resolved against that side’s own
file list and its `tsconfig.json` path aliases. Node builtins are counted
and not drawn. Edges within one area are not drawn. A relative specifier
that resolves to no tracked file is counted as unresolved, never guessed at.

The scan is textual, so a code sample written inside a string literal is
counted as if it were an import — four fixtures under `tests/architecture`
embed `from "x"` and `require("z")` and are the reason single-letter
packages appear below. That is a stated limit of the method, not a package.

#### Source — 6 area edge(s) over 280 source file(s), 29 builtin import(s), 1 unresolved relative, 0 unresolved alias

```
digraph modules {
  "apps/web/e2e" -> "apps/web/e2e/support" [label="28"]
  "apps/web/src" -> "apps/web/src/lib" [label="1"]
  "apps/web/src/app" -> "apps/web/src/components" [label="174"]
  "apps/web/src/app" -> "apps/web/src/lib" [label="320"]
  "apps/web/src/components" -> "apps/web/src/app" [label="7"]
  "apps/web/src/components" -> "apps/web/src/lib" [label="12"]
}
```

#### Target — 90 area edge(s) over 1425 source file(s), 1033 builtin import(s), 3 unresolved relative, 0 unresolved alias

```
digraph modules {
  "apps/system-studio/e2e" -> "apps/system-studio/src/app" [label="2"]
  "apps/system-studio/e2e" -> "apps/system-studio/src/components" [label="4"]
  "apps/system-studio/e2e" -> "apps/system-studio/src/generated" [label="1"]
  "apps/system-studio/e2e" -> "apps/system-studio/src/lib" [label="37"]
  "apps/system-studio/e2e" -> "apps/web/src/lib" [label="1"]
  "apps/system-studio/e2e" -> "modules" [label="2"]
  "apps/system-studio/e2e" -> "packages/configuration/src" [label="4"]
  "apps/system-studio/e2e" -> "packages/contracts/src" [label="1"]
  "apps/system-studio/e2e" -> "packages/finops/src" [label="1"]
  "apps/system-studio/e2e" -> "packages/platform-config/src" [label="5"]
  "apps/system-studio/e2e" -> "packages/provisioning/src" [label="5"]
  "apps/system-studio/src/app" -> "apps/system-studio/src/components" [label="62"]
  "apps/system-studio/src/app" -> "apps/system-studio/src/generated" [label="1"]
  "apps/system-studio/src/app" -> "apps/system-studio/src/lib" [label="284"]
  "apps/system-studio/src/app" -> "blueprints" [label="8"]
  "apps/system-studio/src/app" -> "modules" [label="9"]
  "apps/system-studio/src/app" -> "packages/audit/src" [label="3"]
  "apps/system-studio/src/app" -> "packages/configuration/src" [label="7"]
  "apps/system-studio/src/app" -> "packages/finops/src" [label="7"]
  "apps/system-studio/src/app" -> "packages/module-runtime/src" [label="5"]
  "apps/system-studio/src/app" -> "packages/organization-model/src" [label="1"]
  "apps/system-studio/src/app" -> "packages/platform-config/src" [label="9"]
  "apps/system-studio/src/app" -> "packages/provisioning/src" [label="8"]
  "apps/system-studio/src/components" -> "apps/system-studio/src/app" [label="1"]
  "apps/system-studio/src/components" -> "apps/system-studio/src/lib" [label="14"]
  "apps/system-studio/src/components" -> "packages/provisioning/src" [label="4"]
  "apps/system-studio/src/lib" -> "apps/system-studio/src/app" [label="3"]
  "apps/system-studio/src/lib" -> "apps/system-studio/src/components" [label="5"]
  "apps/system-studio/src/lib" -> "blueprints" [label="1"]
  "apps/system-studio/src/lib" -> "modules" [label="2"]
  "apps/system-studio/src/lib" -> "packages/audit/src" [label="2"]
  "apps/system-studio/src/lib" -> "packages/configuration/src" [label="6"]
  "apps/system-studio/src/lib" -> "packages/contracts/src" [label="2"]
  "apps/system-studio/src/lib" -> "packages/finops/src" [label="4"]
  "apps/system-studio/src/lib" -> "packages/module-runtime/src" [label="1"]
  "apps/system-studio/src/lib" -> "packages/organization-model/src" [label="1"]
  "apps/system-studio/src/lib" -> "packages/platform-config/src" [label="3"]
  "apps/system-studio/src/lib" -> "packages/provisioning/src" [label="33"]
  "apps/web/e2e" -> "apps/web/e2e/support" [label="39"]
  "apps/web/e2e" -> "apps/web/src/components" [label="1"]
  "apps/web/scripts" -> "apps/web/src/lib" [label="1"]
  "apps/web/src" -> "apps/web/src/lib" [label="2"]
  "apps/web/src/app" -> "apps/web" [label="1"]
  "apps/web/src/app" -> "apps/web/src/components" [label="199"]
  "apps/web/src/app" -> "apps/web/src/lib" [label="434"]
  "apps/web/src/app" -> "modules" [label="1"]
  "apps/web/src/app" -> "packages/authorization/src" [label="4"]
  "apps/web/src/app" -> "packages/configuration/src" [label="4"]
  "apps/web/src/app" -> "packages/contracts/src" [label="7"]
  "apps/web/src/app" -> "packages/finops/src" [label="3"]
  "apps/web/src/app" -> "packages/identity/src" [label="2"]
  "apps/web/src/app" -> "packages/module-runtime/src" [label="1"]
  "apps/web/src/app" -> "packages/payments/src" [label="3"]
  "apps/web/src/app" -> "packages/platform-config/src" [label="24"]
  "apps/web/src/components" -> "apps/web/src/app" [label="7"]
  "apps/web/src/components" -> "apps/web/src/lib" [label="20"]
  "apps/web/src/components" -> "packages/platform-config/src" [label="5"]
  "apps/web/src/lib" -> "apps/web" [label="1"]
  "apps/web/src/lib" -> "apps/web/scripts" [label="1"]
  "apps/web/src/lib" -> "apps/web/src" [label="1"]
  "apps/web/src/lib" -> "apps/web/src/app" [label="7"]
  "apps/web/src/lib" -> "apps/web/src/components" [label="3"]
  "apps/web/src/lib" -> "blueprints" [label="5"]
  "apps/web/src/lib" -> "modules" [label="4"]
  "apps/web/src/lib" -> "packages/audit/src" [label="8"]
  "apps/web/src/lib" -> "packages/authorization/src" [label="13"]
  "apps/web/src/lib" -> "packages/configuration/src" [label="3"]
  "apps/web/src/lib" -> "packages/contracts/src" [label="14"]
  "apps/web/src/lib" -> "packages/finops/src" [label="2"]
  "apps/web/src/lib" -> "packages/identity/src" [label="6"]
  "apps/web/src/lib" -> "packages/metadata/src" [label="2"]
  "apps/web/src/lib" -> "packages/organization-model/src" [label="1"]
  "apps/web/src/lib" -> "packages/payments/src" [label="4"]
  "apps/web/src/lib" -> "packages/platform-config/src" [label="25"]
  "apps/web/src/lib" -> "packages/provisioning/src" [label="1"]
  "apps/web/src/lib" -> "packages/releases/src" [label="1"]
  "apps/web/src/lib" -> "packages/workflow/src" [label="2"]
  "blueprints" -> "blueprints/corporate-divisions" [label="1"]
  "blueprints" -> "blueprints/nonprofit-program-operations" [label="1"]
  "blueprints" -> "blueprints/university-student-organizations" [label="1"]
  "blueprints/corporate-divisions" -> "blueprints" [label="1"]
  "blueprints/nonprofit-program-operations" -> "blueprints" [label="1"]
  "blueprints/university-student-organizations" -> "blueprints" [label="1"]
  "tests" -> "tools" [label="1"]
  "tests/architecture" -> "tools" [label="44"]
  "tests/architecture" -> "tools/loop" [label="1"]
  "tests/security" -> "tools" [label="10"]
  "tools" -> "apps/web/src/lib" [label="2"]
  "tools" -> "tools/loop" [label="1"]
  "tools/loop" -> "tools" [label="1"]
}
```

### Observed — external packages, and whether a manifest declares them

An **undeclared** row is a real defect rather than a curiosity: the import
resolves today through npm’s flat `node_modules` and breaks on the day the
transitive dependency that hoisted it is removed.

#### Source — 38 area/package pair(s), 2 undeclared

| Area | Package | Imports | Declared |
| --- | --- | ---: | --- |
| `apps/web` | `@eslint/eslintrc` | 1 | **no** |
| `apps/web/src/lib` | `server-only` | 10 | **no** |

#### Target — 113 area/package pair(s), 48 undeclared

| Area | Package | Imports | Declared |
| --- | --- | ---: | --- |
| `apps/system-studio/src/lib` | `@jest/globals` | 1 | **no** |
| `apps/web` | `@eslint/eslintrc` | 1 | **no** |
| `apps/web/src/components` | `@jest/globals` | 1 | **no** |
| `apps/web/src/lib` | `@jest/globals` | 14 | **no** |
| `apps/web/src/lib` | `server-only` | 19 | **no** |
| `blueprints` | `@tenure/module-runtime` | 1 | **no** |
| `blueprints` | `@tenure/organization-model` | 1 | **no** |
| `modules` | `@tenure/contracts` | 1 | **no** |
| `modules` | `@tenure/finops` | 1 | **no** |
| `packages/audit/src` | `@tenure/contracts` | 1 | **no** |
| `packages/authorization/src` | `@tenure/blueprints` | 1 | **no** |
| `packages/configuration/src` | `@tenure/contracts` | 4 | **no** |
| `packages/configuration/src` | `@tenure/modules` | 3 | **no** |
| `packages/configuration/src` | `@tenure/platform-config` | 1 | **no** |
| `packages/contracts/src` | `@jest/globals` | 1 | **no** |
| `packages/generality-fixtures/src` | `@tenure/authorization` | 1 | **no** |
| `packages/generality-fixtures/src` | `@tenure/blueprints` | 3 | **no** |
| `packages/generality-fixtures/src` | `@tenure/organization-model` | 2 | **no** |
| `packages/generality-fixtures/src` | `@tenure/platform-config` | 1 | **no** |
| `packages/generality-fixtures/src` | `@tenure/workflow` | 1 | **no** |
| `packages/module-runtime/src` | `@jest/globals` | 1 | **no** |
| `packages/module-runtime/src` | `@tenure/authorization` | 2 | **no** |
| `packages/module-runtime/src` | `@tenure/contracts` | 1 | **no** |
| `packages/module-runtime/src` | `@tenure/finops` | 1 | **no** |
| `packages/module-runtime/src` | `@tenure/platform-config` | 1 | **no** |
| `packages/organization-model/src` | `@tenure/blueprints` | 1 | **no** |
| `packages/payments/src` | `@tenure/platform-config` | 2 | **no** |
| `packages/platform-config/src` | `@tenure/authorization` | 1 | **no** |
| `packages/platform-config/src` | `@tenure/blueprints` | 3 | **no** |
| `packages/platform-config/src` | `@tenure/configuration` | 9 | **no** |
| `packages/platform-config/src` | `@tenure/module-runtime` | 2 | **no** |
| `packages/platform-config/src` | `@tenure/modules` | 4 | **no** |
| `packages/platform-config/src` | `@tenure/organization-model` | 1 | **no** |
| `packages/platform-config/src` | `@tenure/payments` | 2 | **no** |
| `packages/platform-config/src` | `zod` | 4 | **no** |
| `packages/provisioning/src` | `@jest/globals` | 4 | **no** |
| `packages/provisioning/src` | `@tenure/identity` | 1 | **no** |
| `packages/releases/src` | `@tenure/configuration` | 1 | **no** |
| `packages/releases/src` | `@tenure/contracts` | 1 | **no** |
| `tests/architecture` | `@tenure/blueprints` | 1 | **no** |
| `tests/architecture` | `tailwindcss` | 1 | **no** |
| `tests/architecture` | `typescript` | 1 | **no** |
| `tests/architecture` | `x` | 5 | **no** |
| `tests/architecture` | `z` | 1 | **no** |
| `tools` | `x` | 2 | **no** |
| `tools` | `z` | 1 | **no** |
| `tools/dev` | `@aws-sdk/client-dynamodb` | 3 | **no** |
| `tools/dev` | `@aws-sdk/lib-dynamodb` | 4 | **no** |
