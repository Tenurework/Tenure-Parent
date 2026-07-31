# Tenure-Parent

This repository is `github.com/satvikOS/Tenure-Parent`. It holds the multi-tenant
platform architecture: `ARCHITECTURE.md`, `CURRENT-STATE-INVENTORY.md`,
`REVIEW-FINDINGS.md`.

## Pushing

**Commit and push to `main` in THIS repository, periodically, as you work.** Do not
save work up for one large push at the end — push each coherent piece as it is
finished, so progress is durable and visible between sessions.

**Never push to `github.com/satvikOS/Tenure`.** That is a different repository with
a different job, and it has a deploy pipeline: a push to its `main` builds a
container, applies Terraform and rolls production ECS for a live pilot carrying
real student data. Nothing produced here belongs there.

If you believe something you are working on needs to change the Tenure app, stop
and say so rather than pushing it. That is a decision for the person you are
working with, not a step in a task.

## The relationship to Tenure

`C:\Users\adiab\Tenure` is the working product — Next.js, Prisma, ECS — and it came
first. It is **prior art to consult, not this repository's output.** Read it when
you need to know how something is actually implemented today, or to check whether
a claim in `ARCHITECTURE.md` still matches reality. Refer to it occasionally and
deliberately; do not mirror it, vendor it, or treat its structure as this
repository's target shape.

Treat it as read-only from here. Do not edit files in it, do not commit in it, do
not run its build, tests or deploy workflows.

## Before implementing anything from ARCHITECTURE.md

Read `REVIEW-FINDINGS.md` first. It reviews the architecture spec adversarially and
records real defects in it — an RLS bootstrap deadlock, two contradictory
`withTenant` designs, three mutually exclusive target schemas. Implementing the
spec without reading the review means implementing known-broken designs.
