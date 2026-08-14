# The Tenure landing zone, modelled — and today's estate reconciled against it

**GE-010-002.** Status: **proposed**. Nothing here has been applied.

- Model: [`ge-landing-zone-model.json`](./ge-landing-zone-model.json) — the machine-readable form, and the one that is checked.
- Guard: `tests/architecture/ge-landing-zone-model.test.mjs`
- Shape decided by: [`../decisions/ADR-0007-tenure-owned-aws-organization.md`](../decisions/ADR-0007-tenure-owned-aws-organization.md)
- Estate read from: [`aws-inventory.json`](./aws-inventory.json), observed `2026-07-31T23:40:04.289Z`

## Why this is a model and not a reconciliation in AWS

The requirement's verb is "model **or** reconcile". Reconciling in AWS is not
available: the inventory run recorded `organizations:describe-organization`,
`organizations:list-accounts` and `organizations:list-roots` all denied, and
`organization.inUse: false`. **There is no AWS Organization**, so there are no
OUs to reconcile against and no accounts to move anything into. ADR-0007 records
why creating one is the operator's decision — the management account is fixed
forever at creation, consolidated billing is a commercial arrangement, member
accounts need real root emails and tax details, and the account that exists
today is running a live pilot with real student data.

What is available is the other verb, and it is the half that has to be right
before anybody vends an account: name the nine nodes, say what each is for, and
place **every resource that actually exists** against one of them. That last
part is what makes this a model of *this* estate rather than a redrawing of the
diagram in the ADR.

## The nine nodes

| Node | Kind | Accounts | For |
|---|---|---|---|
| Management | account | one | The account the Organization is created from. Runs nothing. |
| Security | OU | one | Delegated security administration — GuardDuty, Config, Security Hub. |
| Log Archive | OU | one | Write-once organization trail and Config history. |
| Infrastructure | OU | one | Shared build, artifact and registry estate; DNS and certificates; Terraform state. |
| Tenure Parent | OU | one | The global distribution engine and the System Studio. |
| Nonproduction | OU | one per cell | Development and staging cells. |
| Production Cells | OU | one per cell | Pooled and bridge tenants, by cell. The live pilot is one of these. |
| Dedicated Tenants | OU | one per dedicated tenant | One Tenure-owned account per siloed tenant, vended for them. |
| Quarantine | OU | zero or more | Detached, deny-all. Exists from day one, empty. |

The eight OUs are exactly the tree ADR-0007 fixed; the guard reads that tree out
of the ADR and fails if the two ever disagree. The nine names are read out of the
requirement line itself, so the model cannot quietly drop one.

## Where today's estate lands

Thirty-nine named resources are derived from the inventory — VPCs, load
balancers, distributions, clusters, registries, databases, tables, caches,
buckets, queues, secrets, log groups, alarms and deployment roles. Each is placed
exactly once:

| Node | Resources placed |
|---|---:|
| Production Cells | 26 |
| Tenure Parent | 7 |
| Infrastructure | 4 |
| *undecided* | 2 |

Two are deliberately left unplaced, each with the decision that would settle it:

- `vpc:172.31.0.0/16` — the default VPC of the account that exists today,
  carrying no workload. Its node follows that account's disposition, which
  ADR-0007 leaves to the operator.
- `iam-role:AWSServiceRoleForECS` — a service-linked role AWS creates in
  whichever account runs ECS. It will exist in every account that runs a task,
  so placing it against one node would be false.

The count of unplaced resources is a ratchet in the guard: it may fall as
decisions land, and raising it is how an unplaced resource would become
permanent.

### Five nodes have nothing to place, and that is the finding

Security, Log Archive, Nonproduction, Dedicated Tenants and Quarantine take
nothing from today's estate. Not because the model is incomplete, but because the
estate contains no security-tooling account, no log archive, no nonproduction
environment, no backup vault, no KMS alias, no WAF and no hosted zone. Every
resource that exists belongs to either the pilot or the Studio, and both of them
sit in the same account as each other.

### Two placements worth arguing with

- **Registries go to Infrastructure, not to the workload.** `tenure-pilot-app`
  and `tenure-studio` are pull-side dependencies of a cell, not property of it.
  A cell that owns its own registry cannot be rebuilt from the engine.
- **`secret:tenure-pilot/dev-login` is placed where it lives, not where it
  belongs.** A dev-login secret in a production account is a containment item in
  its own right; moving it is not a landing-zone decision and this model does not
  pretend to have made it.

## What this does not claim

- No node exists in AWS. The guard asserts that every `exists_in_aws` is `false`
  for as long as the inventory reports no Organization, so this file cannot
  quietly become a description of something nobody created.
- No placement has been applied. Every `disposition` is `proposed`, and the guard
  refuses any other value.
- Creating the OUs and vending accounts is **GE-010-004**, which is blocked on
  the operator decisions ADR-0007 names. Proving that nonproduction roles cannot
  reach production is **GE-010-006**, and it is not provable in a single-account
  estate — IAM is account-scoped.
