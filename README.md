# Tenure Parent — platform architecture

The long-term architecture for turning Tenure from a single-institution application into a
globally deployable, multi-tenant organizational operating platform.

## What is here

| File | What it is |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | The specification. ~7,200 lines, 28 Mermaid diagrams, 77 SQL blocks, 54 code/pseudocode blocks. |
| [`CURRENT-STATE-INVENTORY.md`](./CURRENT-STATE-INVENTORY.md) | A direct reading of the existing Tenure codebase: every Prisma model, its keys, which tenant columns it carries, where single-institution assumptions live. Every other section is built on this. |
| [`REVIEW-FINDINGS.md`](./REVIEW-FINDINGS.md) | An adversarial review of the specification. **Read this before implementing anything.** |

## Read the review first

The specification's sections were authored in parallel against a shared current-state brief,
then reviewed by an independent pass instructed to find only defects. It found real ones,
including several that would not work as written:

- **An RLS bootstrap deadlock.** `InstitutionMembership` is inside the RLS enable set, but
  reading memberships is how a request resolves its tenant in the first place. As specified,
  nobody can authenticate. A bootstrap primitive has to be named.
- **Two incompatible `withTenant` designs**, with different GUCs and opposite failure
  semantics (fail-empty vs fail-loud), both labelled as real code. One must be deleted, and
  fail-loud is the correct one.
- **Effective-permission SQL that never checks membership state**, so suspended members and
  disabled principals keep every capability.
- **Three mutually exclusive target schemas**, all marked MVP, two of which silently
  contradict the document's own accepted decisions about not renaming tables or migrating
  primary keys.

None of these are reasons to distrust the specification as a whole — they are the reason the
review exists. Treat `ARCHITECTURE.md` as a strong draft with a known defect list, not as a
finished blueprint.

## Grounding

Nothing here is generic SaaS advice. The inventory was produced by reading the actual
application: Next.js 15 App Router, Prisma 6, PostgreSQL 16 on RDS, NextAuth 5 beta with a
JWT session strategy, ECS Fargate behind CloudFront, schema applied via `prisma db push`
with no migration history.

Findings that shape the whole migration, drawn from that reading:

- `Organization.slug`, `Role.positionCode`, `Deliverable.key`, `DirectoryPerson.email` and
  `ApprovalRequest.idempotencyKey` are **globally unique**, so two tenants cannot both have a
  club called `consulting`.
- Of the models carrying `institutionId`, only about half declare a relation to
  `Institution`; the rest hold a bare string with nothing enforcing that it agrees with the
  parent organization.
- `Resource` is the only model with a correct composite tenant key,
  `@@unique([institutionId, key])`.
- There is no `middleware.ts`, so there is no request-level tenant interceptor — every page,
  route handler and server action resolves tenancy for itself today.

## Status

Specification and review complete. No implementation has begun, and the defects in
`REVIEW-FINDINGS.md` should be resolved before it does.
