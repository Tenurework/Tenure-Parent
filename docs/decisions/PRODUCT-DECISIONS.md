# Product decisions

Confirmed answers to questions that repository inspection could not settle.
Each entry records what was asked, what was chosen, and what it commits us to.
Superseding an entry means adding a new one, not editing the old.

---

## PD-001 — The platform monorepo is Tenure-Parent; the application moves into it

**Date:** 2026-07-30 · **Status:** Accepted

**Question.** The build directive names this repository as the complete platform
monorepo, but `satvikOS/Tenure-Parent` holds only documentation, while the
working, deployed system is a separate repository (`satvikOS/Tenure`). Where
does the platform get built?

**Decision.** Migrate `satvikOS/Tenure` into `Tenure-Parent` as `apps/web`,
preserving git history, and build `packages/` around it there.

**Rejected alternatives.**

- *Evolve `satvikOS/Tenure` in place.* Lower risk — the deploy pipeline never
  moves — but it leaves the repository the directive names as the platform
  holding nothing that runs.
- *Build `packages/` in Tenure-Parent first, integrate later.* Rejected on the
  directive's own terms: platform packages written against no application
  cannot be validated against the real 39-model schema, which is the
  "disconnected second implementation" §1.1 prohibits.

**Commits us to.** Moving every path the deployment depends on — Dockerfile
build context, `.github/workflows/*` working directories, Terraform's reference
to the image, Prisma's schema location — in one verified change. The live pilot
must keep deploying across the move; that is the acceptance criterion, not a
nice-to-have.

---

## PD-002 — Ship the boot-safety work directly to production

**Date:** 2026-07-30 · **Status:** Accepted

**Question.** The migration and boot-safety slice changes how every container
starts. Merge to `main` (which deploys) now, or hold it behind review?

**Decision.** Merge to `main` and deploy.

**Basis.** The pilot's observable behaviour is unchanged: dev sign-in still
works, reference data is already in the database, and the schema is provably
identical before and after (empty `migrate diff` in both directions). Failure is
contained — a container that cannot verify its schema exits, and the ECS
deployment circuit breaker returns to the previous task definition.

**Commits us to.** Watching the first deploy specifically for the bootstrap
recording the baseline against the live RDS, since that path has been verified
only against a reconstruction of the pilot's shape, never the pilot itself.

---

## PD-003 — Close the public sign-in exposure with an interim gate, not by waiting for Okta

**Date:** 2026-07-30 · **Status:** Accepted

**Question.** `AUTH_DEV_LOGIN=true` plus seeded `@tenure.demo` accounts means
anyone who reaches the public CloudFront URL can sign in as OSE Director. The
real fix is Okta, which needs credentials from the institution. Accept the
exposure meanwhile, wait for Okta, or build a stopgap?

**Decision.** Build an interim gate now. Okta remains the real fix and is not
descoped by this.

**Basis.** The exposure is live, public, and grants the highest role in the
system. Its duration is set by an external party's procurement timeline, which
is not a schedule the risk should be tied to.

**Commits us to.** An interim control is a control: it needs to fail closed, be
enforced server-side rather than by hiding UI, and be removable in one step when
Okta lands, without leaving a second sign-in path behind.
