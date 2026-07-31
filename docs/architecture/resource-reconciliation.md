# Resource reconciliation

**GE-001-005.** What the repository declares, against what the account actually holds.

Generated 2026-07-31T23:40:04.289Z. Terraform ownership is read from the repository, because
the AWS API cannot report which tool owns a resource.

## Terraform stacks in this repository

| Stack | State key | Owns |
|---|---|---|
| `infrastructure/terraform` | `pilot/terraform.tfstate` | The Simon OSE pilot. Deployed from `satvikOS/Tenure`, **not** from here. |
| `infrastructure/studio` | `studio/terraform.tfstate` | The System Studio engine. Deployed from this repository. |

Two stacks, two state files, one account. The separation is the safety property: two
repositories applying different code against one state file means whichever runs second
sees the other's resources as undeclared and destroys them.

## CloudFormation / CDK

No CloudFormation stacks. Terraform is the single IaC system, which is what the prompt asks for — no parallel ownership.

## Unreconciled

Resources present in the account that neither stack declares are drift, or belong to
something outside this repository. Compare the CloudFront, ECS, RDS, S3 and secret lists in
`aws-current-state.md` against the two stacks above; anything unaccounted for is listed here
once a reviewer has classified it. Automating that classification requires reading both
state files, which this job deliberately does not do — a state file contains resource
attributes including generated passwords.
