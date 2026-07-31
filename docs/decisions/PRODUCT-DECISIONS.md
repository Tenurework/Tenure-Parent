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

## PD-004 — SSO will be AWS Cognito, and the edge gate comes off until it lands

**Date:** 2026-07-31 · **Status:** Accepted · **Supersedes:** the Okta half of PD-003

**Decision, two parts.**

1. **Single sign-on will be AWS Cognito, not Okta.** Every mention of Okta in
   this repository predates the decision and none of it was ever used — the
   pilot has always signed in through the passwordless `dev-login` provider.
   `src/lib/auth.ts` registers an Okta provider when `OKTA_ISSUER` looks like a
   URL, Secrets Manager carries `OKTA_*` keys, and the runbook documented an
   Okta procedure. All of it is now dead code with a plan attached; see ADR-0005.

2. **The CloudFront edge gate is off** (`edge_gate_enabled = false`) until
   Cognito is rolled out. The sign-in passphrase is the only control in front of
   the pilot.

**Basis for part 2.** The two-gate arrangement meant a pilot user needed a
one-time link before they could see a login form at all, and the thing behind
both gates is a single shared passphrase. Someone holding it was given it
deliberately; someone without it gets no further inside CloudFront than outside.
The friction was real and the marginal protection was small.

**What it commits us to, stated rather than assumed.** The exposure is not that
the passphrase can be guessed — 24 characters over a 36-symbol alphabet is about
124 bits. It is that a single shared secret travels by email and chat, identifies
nobody, and grants a one-click `OSE_DIRECTOR` account to whoever ends up with it.
Two consequences follow and are now on the critical path rather than nice to
have:

- **Rate limiting.** Nothing throttles the sign-in form, and AI synthesis calls a
  paid API per question with no per-user quota. The edge gate was what made that
  survivable.
- **Cognito is now load-bearing.** While it is outstanding, the pilot's entire
  access control is one shared string.

`X-Robots-Tag: noindex, nofollow` is set app-wide so a named university's pilot
does not end up in search results.

Re-closing is one line in `edge-access.tf` plus an apply; the CloudFront Function
stays built and published rather than deleted, precisely so that stays true.

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

---

## PD-009 — `satvikOS/Tenure` keeps deploying production; Tenure-Parent stays disarmed

> **Renumbered from PD-004 on 2026-07-31.** It collided with an upstream PD-004
> ("SSO will be AWS Cognito"), written in `satvikOS/Tenure` while this one was
> written here — the same independent-numbering collision ADR-0005 hit with
> ADR-0004, and for the same reason. The upstream one keeps the number because
> `infrastructure/terraform/edge-access.tf` cites it in two places; this one had
> no references outside the decisions file. The collision was found by the ADR
> index generated for GE-000-007, which is what an index is for.

**Date:** 2026-07-31 · **Status:** Accepted

**Question.** Importing the application into Tenure-Parent brought `deploy.yml`
with it, and Tenure-Parent already holds the same `ACCESSKEYID` /
`SECRETACCESSKEY` secrets. Both repositories therefore reach one AWS account, one
Terraform state file (`pilot/terraform.tfstate`) and one ECS service. Meanwhile a
second working session is actively committing to `satvikOS/Tenure` and deploying
from it — three successful deploys in the hour the import was running. Which
repository owns production?

**Decision.** `satvikOS/Tenure` continues to deploy production. Every
AWS-touching job in Tenure-Parent carries
`if: github.repository == 'satvikOS/Tenure'` and is inert here. Tenure-Parent is
canonical for platform development and re-syncs from Tenure.

**Basis.** Exactly one deployer. Two pipelines against one Terraform state can
deadlock on the DynamoDB lock or roll conflicting task definitions over each
other, and the failure lands on a live pilot carrying real student data. Nothing
stops shipping in the meantime, because the repository that already deploys keeps
deploying.

**Rejected alternatives.**

- *Cut over now.* The evidence supports it — a read-only `terraform plan` from
  Tenure-Parent against production state is infrastructure-neutral (1 add, 1
  change, 1 destroy, all of it one new ECS task-definition revision; no VPC, RDS,
  S3, CloudFront, ALB, SES, SQS or IAM change). But it requires the other session
  to stop pushing to Tenure, or its pushes silently stop reaching production.
- *Arm both.* The race described above.

**Commits us to.** Cutover being one deliberate switch — flipping the repository
name in the guard, in a reviewed pull request, while disarming Tenure in the same
change. Not deleting the guard, and not arming a second deployer alongside the
first. `tests/security/production-workflows-disarmed.test.mjs` fails the build if
a guard goes missing, and `platform-plan.yml` re-establishes the evidence on
demand.

---

## PD-005 — Ship to production on green CI; report after

**Date:** 2026-07-31 · **Status:** Accepted

**Question.** Production is a live pilot carrying real Simon Business School
student data. What standing authority applies to changes that reach it?

**Decision.** Deploy autonomously once every CI job passes — lint, type check,
258+ unit tests, tenant-isolation integration tests, 132 e2e specs, migration
drift and apply, container build and inspection. Verify `/api/health` and the ECS
running count afterwards, roll back on failure, and report what happened.

**Rejected alternatives.**

- *Ask before each production change.* Slower, and the failure it prevents is
  already covered by the gates above.
- *A staging soak first.* A parallel RDS/ECS stack under its own Terraform state
  key. Real value, real recurring AWS cost, and not yet justified at one tenant.
  Worth revisiting before tenant #2 is provisioned.

**Commits us to.** CI actually being the gate it claims to be. The isolation test
that had been failing on `satvikOS/Tenure` since `8f5f151` — blocking every
deploy — is the worked example of what happens when it is not: six commits sat
undeployed behind an assertion that depended on data nothing seeded.

---

## PD-006 — `satvikOS/Tenure` is tenant #1, not the product

**Date:** 2026-07-31 · **Status:** Accepted

**Question.** How should the relationship between `satvikOS/Tenure` and the
platform be modelled?

**Decision.** The system `satvikOS/Tenure` deploys **is one tenant's system** —
Simon OSE, the Ainslie Office of Student Engagement at Simon Business School. It
is not "the product" that Tenure-Parent abstracts over.

**Basis.** The two readings produce different architectures. If the pilot is the
product, the platform is a layer added on top and every institution-specific
value stays where it is. If the pilot is tenant #1, then every such value is a
tenant overlay that the platform must be able to produce — and `"Ainslie OSE"` as
a literal in eight files is a defect rather than a detail.

**Commits us to.** Being able to stand up Simon OSE from a blueprint plus an
overlay, with no code that names it. `blueprints/tenants.ts` binds slug
`rochester` to the `university-student-organizations` blueprint and supplies the
office's real name; `blueprints/nonprofit-program-operations` exists as a
structurally different second system so that the claim is testable rather than
asserted. The slug stays `rochester` because that is what the database says;
renaming it is a data migration and belongs to ADR-0004's programme.

---

## PD-007 — Tenant systems live under a path prefix; the platform engine gets its own host

**Date:** 2026-07-31 · **Status:** Accepted

**Question.** Two questions, answered together because the answers only make
sense as a pair.

1. `ADR-0004` Decision **A**, recorded there as outstanding and blocking M9:
   once organization slugs are per-tenant, what is a club's URL?
2. Where does the Tenure platform engine — the System Studio, and the control
   plane behind it — actually live?

**Decision.**

**A tenant's system is served under a path prefix naming that tenant**, on the
platform host:

```
platform.tenurework.com/simon/orgs/consulting-club
platform.tenurework.com/<tenant>/...
```

The prefix is the tenant's own name — `simon`, not `rochester` and not an
opaque id. The system belongs to the Ainslie Office of Student Engagement at
Simon Business School; `simon` is what the people using it call it.

**The platform engine gets a separate host of its own.** Until that host exists
it is reachable at the CloudFront URL, and the custom domain belongs to tenant
systems.

**Why the pair matters.** These are the same decision seen twice. A prefix-less
host cannot serve two tenants, and a host that serves tenants cannot also serve
the console that configures them — not for routing reasons but for blast radius:
the Studio shows every tenant's configuration, so putting it on a customer's
origin makes one authorization bug a cross-customer disclosure.

**What it settles that was open.**

- `ADR-0004` Decision A is now decided, in the form its own recommendation
  favoured (a path prefix, not a session-derived tenant) but with the tenant's
  name rather than `/i/<slug>`. A URL means the same thing to everyone who
  holds it, which is what makes it shareable in a Slack message and
  diagnosable in a support ticket.
- M9 — persisting the acting institution — is unblocked. The prefix IS the
  acting institution, validated against membership on every request exactly as
  `resolveTenantScope(userId, institutionId)` already supports.

**Commits us to.**

- The ~41 URL construction sites and 18 `revalidatePath` calls `ADR-0004`
  costed, plus a redirect layer so existing links keep working.
- A tenant slug that is stable and human-meaningful, since it is now in every
  URL anyone bookmarks or pastes. `simon` is the tenant's name; the database
  slug is `rochester` today, and reconciling those is a data migration owned by
  the schema programme, not a rename done in passing.
- **Removing `/studio` from `apps/web`.** It currently ships inside the tenant's
  container on the tenant's domain, with `PLATFORM_OPERATORS` as the only thing
  between a customer's application and the console that configures every
  customer. That was tolerable while nothing else existed; this decision makes
  it wrong. It moves to `apps/system-studio`.

**Not yet decided.** The engine's hostname. Whichever it is, the constraint
above stands: it is not a host that also serves a tenant.

---

## PD-008 — This repository is the engine. It is not a tenant, and should not contain one.

**Date:** 2026-07-31 · **Status:** Accepted, partially implemented

**Question.** `Tenure-Parent` currently contains `apps/web` — the tenant
application — imported under ADR-0005 on the reading that this repository is
"the canonical monorepo for everything". Is that right?

**Decision.** No. **This repository is the global Tenure distribution engine and
nothing else.** The engine and a tenant are different products: different code,
different modules, different infrastructure, different audiences. One repository
holding both invites exactly the confusion that put the cross-tenant console on
a customer's origin.

**What is already true.**

- `apps/system-studio` is the engine, deployed to its own CloudFront
  distribution, its own cluster, its own load balancer and its own Terraform
  state. Live at `https://d2kj4iy5i37kfd.cloudfront.net`.
- `/studio` is gone from `apps/web`.
- The platform engines live in `packages/`, and the system definitions in
  `blueprints/` and `modules/`.

**What is not yet true, and is the remaining work.**

`apps/web` is still here. It is a **duplicate** of `satvikOS/Tenure`, which is
where it is developed and from which it deploys. Keeping it has cost a merge on
every sync and will keep costing them.

It cannot simply be deleted, because it is currently the only consumer of most
of the engines — module-driven navigation, the approval workflow, the resource
form, terminology and localization are all wired into it, and those wirings are
what prove the packages work against a real application rather than against
fixtures.

So the sequence is:

1. **Publish the engines for consumption.** `@tenure/configuration`,
   `authorization`, `module-runtime`, `organization-model`, `workflow`,
   `releases`, `metadata`, `audit`, `platform-config` are consumed by path today.
   A tenant in another repository needs them by version.
2. **Move the integrations to the tenant.** The navigation, approval-flow,
   resource-form and terminology wirings belong in `satvikOS/Tenure`, as pull
   requests — never pushes, because that repository deploys production on push
   to `main`.
3. **Then remove `apps/web` from here**, once its integrations live where the
   application does and the engines are consumable by version.

Doing (3) first would delete the evidence that (1) and (2) work.

**Commits us to.** Not adding new tenant-application features here. Work that
belongs to the tenant goes to `satvikOS/Tenure`; work that belongs to the engine
stays. `apps/web` remains only as the integration proof until it is no longer
needed for that.
