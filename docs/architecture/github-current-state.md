# GitHub current state

**GE-001-001.** Generated 2026-07-31T23:09Z from the GitHub API.
Secret **names** only — no value is read or recorded anywhere in this file.

## Repository

| | |
|---|---|
| Name | Tenure-Parent |
| Visibility | **PUBLIC** |
| Default branch | `main` |

> Visibility is **public**. Everything a workflow prints — logs, step summaries, artifacts —
> is world-readable and archived. This is the single most important fact on this page and it
> constrains every later decision about evidence, inventory output and secret handling.

## Secrets (names only)

| Name | Last updated | Used by |
|---|---|---|
| `ACCESSKEYID` | 2026-07-29 | |
| `PLATFORM_OPERATORS` | 2026-07-31 | |
| `PLATFORM_OPERATOR_SECRET` | 2026-07-31 | |
| `SECRETACCESSKEY` | 2026-07-29 | |

## Variables

None. `AWS_REGION` is referenced by four workflows with a literal `us-east-1` fallback, so region is effectively hard-coded — a gap for GE-011.

## Environments

**None.** No protected environment exists, so no deployment is gated on a human reviewer.
Required by GE-001-002 for the inventory workflow and by GE-173 for production. **Gap.**

## Branch protection / rulesets

**None.** `main` is unprotected: no required checks, no required review, force-push allowed.
Every commit in this repository has gone directly to `main`. **Gap**, drives GE-170.

## OIDC

`id-token: write` is requested by:
- `.github/workflows/deploy.yml`

**No workflow authenticates to AWS by OIDC.** All four AWS-touching workflows use the
long-lived `ACCESSKEYID` / `SECRETACCESSKEY` pair. This is the finding that drives **GE-011**.

## Workflows

See `docs/implementation/repository-map.md` for the generated table of all 14 with their
triggers, whether they reach AWS, and which repository each is guarded to.

## Action pinning

Actions are referenced by **tag**, not by commit SHA:

- `uses: actions/checkout@v4`
- `uses: actions/setup-node@v4`
- `uses: actions/upload-artifact@v4`
- `uses: aws-actions/configure-aws-credentials@v4`
- `uses: docker/build-push-action@v5`
- `uses: docker/setup-buildx-action@v3`
- `uses: hashicorp/setup-terraform@v3`

GE-170 requires full commit SHAs. A tag is mutable: whoever controls the action can change
what `@v4` points at, and these workflows hold production AWS credentials. **Gap.**
