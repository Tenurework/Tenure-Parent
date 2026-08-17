# Simon absorption — repository inventory

**Generated** by `node tools/simon-absorption-inventory.mjs` from
`docs/architecture/simon-absorption-inventory.json`. Do not edit by hand — `tests/simon-absorption-inventory.test.mjs`
re-renders this file from the snapshot and reds on any difference.

Closes **SIMON-000-001**. Source repository read from `refs/remotes/live/main` only: the pilot is
never cloned, checked out or pushed to from here.

Two repositories, recorded at the same moment, from git plumbing and the
GitHub API. A field this run could not read is `UNKNOWN` with the command
that would answer it — never an empty list, because a refusal is not an
absence.

Observed at **2026-08-17**. Source pinned to `47c1128cb55953b11bedc47927508bc5d622b159`.

## Repositories

### Source

| Fact | Value |
| --- | --- |
| Role | source — the Simon OSE pilot application being absorbed |
| Configured remote | `live` → `https://github.com/satvikOS/Tenure.git` |
| Canonical name (GitHub) | Tenurework/Tenure |
| Visibility | PUBLIC |
| Fork | false |
| Default branch | main |
| Branches known here | 15 |
| Tags (GitHub) | none |
| Tags (local refs) | none |
| Releases | none |
| Deployment environments | none |
| Open pull requests | #45 docs(runbook) + fix(platform-access): the read-only route, and the exit-code read that crashed |
| Commits on the recorded head | 171 |
| Oldest commit | `abf30691f829` (2026-07-10) |
| Newest commit | `47c1128cb559` (2026-08-14) |
| Contributors | 3 — Monorepo Migration, satvikOS, verification |
| Tracked files | 364 |
| Working tree | NOT CHECKED OUT — read from remote-tracking refs only; this repository never clones or pushes the pilot. |

| Branch | Commit |
| --- | --- |
| `live` | `47c1128cb559` |
| `live/fix/active-org-scope` | `f151ae556b83` |
| `live/fix/canonical-digest` | `eb16bfca4d01` |
| `live/fix/canonical-seat-truth` | `9cfff4e667cc` |
| `live/fix/csp-report-only` | `28b7b4b6d806` |
| `live/fix/docx-sanitize` | `4269e7220a1d` |
| `live/fix/e2e-retired-credential-card` | `a121a640fcc8` |
| `live/fix/upload-validation` | `f59c587a93ad` |
| `live/main` | `47c1128cb559` |
| `live/ops-status` | `8537db86a784` |
| `live/platform/reconcile-endpoint` | `0c1a1811eb56` |
| `live/platform/reconcile-secret` | `0ae1a96cf71c` |
| `live/platform/schema-version` | `e3f609dffae6` |
| `live/security/untrack-real-roster` | `6298add8a127` |
| `live/tenant/cognito-auth` | `3526fed7963c` |

### Target

| Fact | Value |
| --- | --- |
| Role | target — this repository, the Tenure parent platform |
| Configured remote | `origin` → `https://github.com/Tenurework/Tenure-Parent.git` |
| Canonical name (GitHub) | Tenurework/Tenure-Parent |
| Visibility | PUBLIC |
| Fork | false |
| Default branch | main |
| Branches known here | 2 |
| Tags (GitHub) | none |
| Tags (local refs) | none |
| Releases | none |
| Deployment environments | `aws-read` `engine-production` |
| Open pull requests | none open |
| Commits on the recorded head | 442 |
| Oldest commit | `abf30691f829` (2026-07-10) |
| Newest commit | `cc4e5291da1c` (2026-08-17) |
| Contributors | 4 — Claude, Monorepo Migration, satvikOS, verification |
| Tracked files | 1526 |
| Working tree | checked out on `main`, 114 dirty path(s) at 2026-08-17 |

| Branch | Commit |
| --- | --- |
| `main` | `cc4e5291da1c` |
| `wip/ier-killed-run-20260808` | `815be47a3c4b` |

## Shared history

| Merge base | `d20d40d7846fc434b539f80cae8e437b750055ed` (2026-07-31) |
| --- | --- |

The two repositories share history: the parent was branched from the pilot. Absorption is therefore a convergence, not an import into an unrelated tree.

## Deployment workflows

### Source — workflows

| File | Name | Triggers | Reaches AWS | Deploys | Repository guard |
| --- | --- | --- | ---: | ---: | --- |
| `.github/workflows/ci.yml` | CI | pull_request, push, workflow_call | — | — | **none** |
| `.github/workflows/custom-domain.yml` | Custom Domain Status | workflow_dispatch | yes | — | **none** |
| `.github/workflows/db-recovery.yml` | Database recovery and census | workflow_dispatch | yes | — | **none** |
| `.github/workflows/debug-logs.yml` | Debug Logs | workflow_dispatch | yes | — | **none** |
| `.github/workflows/deploy.yml` | Deploy | push, workflow_dispatch | yes | **yes** | **none** |
| `.github/workflows/force-redeploy.yml` | Force Redeploy | workflow_dispatch | yes | **yes** | **none** |
| `.github/workflows/ops-status.yml` | Ops Status | push, workflow_dispatch | yes | — | **none** |
| `.github/workflows/probe-debug.yml` | Probe Debug | workflow_dispatch | — | — | **none** |
| `.github/workflows/replace-acm-cert.yml` | Replace ACM Certificate | workflow_dispatch | yes | **yes** | **none** |
| `.github/workflows/rotate-auth-secret.yml` | Rotate Auth Secret | workflow_dispatch | yes | **yes** | **none** |
| `.github/workflows/seed-reference-data.yml` | Seed reference data | workflow_dispatch | yes | — | **none** |
| `.github/workflows/verify-reminders.yml` | Verify Reminders | workflow_dispatch | yes | — | **none** |

### Target — workflows

| File | Name | Triggers | Reaches AWS | Deploys | Repository guard |
| --- | --- | --- | ---: | ---: | --- |
| `.github/workflows/aws-inventory.yml` | AWS · Read-only inventory | workflow_dispatch | yes | — | **none** |
| `.github/workflows/bootstrap-oidc.yml` | AWS · Bootstrap OIDC (one-time) | workflow_dispatch | yes | **yes** | `Tenurework/Tenure-Parent` |
| `.github/workflows/ci.yml` | CI | pull_request, push, workflow_call | — | — | **none** |
| `.github/workflows/custom-domain.yml` | Custom Domain Status | workflow_dispatch | yes | — | `Tenurework/Tenure` |
| `.github/workflows/db-recovery.yml` | Database recovery and census | workflow_dispatch | yes | — | `Tenurework/Tenure` |
| `.github/workflows/debug-logs.yml` | Debug Logs | workflow_dispatch | yes | — | `Tenurework/Tenure-Parent` |
| `.github/workflows/deploy-studio.yml` | Deploy Studio | workflow_dispatch, workflow_run | yes | **yes** | `Tenurework/Tenure-Parent` |
| `.github/workflows/deploy.yml` | Deploy | workflow_dispatch | yes | **yes** | `Tenurework/Tenure` |
| `.github/workflows/force-redeploy.yml` | Force Redeploy | workflow_dispatch | yes | **yes** | `Tenurework/Tenure` |
| `.github/workflows/ops-status.yml` | Ops Status | workflow_dispatch | yes | — | `Tenurework/Tenure` |
| `.github/workflows/platform-plan.yml` | Platform · Terraform plan (read-only) | workflow_dispatch | yes | — | **none** |
| `.github/workflows/probe-debug.yml` | Probe Debug | workflow_dispatch | — | — | `Tenurework/Tenure` |
| `.github/workflows/replace-acm-cert.yml` | Replace ACM Certificate | workflow_dispatch | yes | **yes** | `Tenurework/Tenure` |
| `.github/workflows/rotate-auth-secret.yml` | Rotate Auth Secret | workflow_dispatch | yes | **yes** | `Tenurework/Tenure` |
| `.github/workflows/seed-reference-data.yml` | Seed reference data | workflow_dispatch | yes | — | `Tenurework/Tenure` |
| `.github/workflows/studio-domain.yml` | Studio Domain Status | workflow_dispatch | yes | — | `Tenurework/Tenure-Parent` |
| `.github/workflows/verify-reminders.yml` | Verify Reminders | workflow_dispatch | yes | — | `Tenurework/Tenure` |
| `.github/workflows/visual-baselines-refresh.yml` | Visual baselines · refresh | workflow_dispatch | — | — | **none** |
