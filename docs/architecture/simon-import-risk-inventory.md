# Simon absorption — what importing the source repository carries with it

**Generated** by `node tools/simon-convergence-inventory.mjs` from
`docs/architecture/simon-convergence-inventory.json`. Do not edit by hand — `tests/simon-convergence-inventory.test.mjs`
re-renders this file from the snapshot and reds on any difference.

Closes **SIMON-000-007**. Both repositories are read at the commits pinned by
`docs/architecture/simon-absorption-inventory.json`; the pilot is never cloned, checked out or pushed to
from here.

Eight inventories the bible requires before an import begins. Every one is either read out of
the pinned source tree or recorded as `UNKNOWN` with the command that would answer it. Nothing in
the secret-indicator list is opened: the finding is that a path with that shape exists, and
confirming it by reading the file would be repeating the leak.


Observed 2026-08-18. Source tree `47c1128cb55953b11bedc47927508bc5d622b159`, 364 tracked files.

## Licenses

License, copying and notice files in the source tree: —.

| Manifest | Package | License | Private | Verdict |
| --- | --- | --- | --- | --- |
| `apps/web/package.json` | `tenure` | **none** | yes | no license declared — private, so npm does not require one; an import still needs a stated basis |
| `package.json` | `tenure-parent` | **none** | yes | no license declared — private, so npm does not require one; an import still needs a stated basis |

Dependency licenses: UNKNOWN — `npm view <package> license` did not answer — the license of each declared source dependency — resolvable only per package against the registry, and this generator does not install.

## Generated artifacts tracked in the source tree

| Path | Why it counts as generated |
| --- | --- |
| `package-lock.json` | a resolver lockfile |

## Vendored code

22 paths. First 20:

| Path | Why |
| --- | --- |
| `Tier1/2026 Simon Club Deliverables & Timelines.pdf` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/2026-2027 Simon's Club Transition Process  (1).pdf` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/Career Oriented Travel Guidance 2025-2026.pdf` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/Club Board Descriptions-selected.zip` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/Club Board Resources - Simon Business School.Alumni Outreach.pdf` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/Club Board Resources - Simon Business School.pdf` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/Club Deliverables & Expectations.pdf` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/Club Leaders Transition_Onboarding Checklist (1).pdf` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/Job Descriptions 2026-selected.zip` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/SIMON BUSINESS SCHOOL CLUB EVENT REQUEST & EXECUTION GUIDE.pdf` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/Simon Business School Off-Campus Event Alcohol Policy (1).pdf` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/extracted/board-descriptions/Job Description_Club Advisors.pdf` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/extracted/board-descriptions/Job Description_President_2025 (2).pdf` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/extracted/board-descriptions/Job Description_VP of Events and Partnerships_2025 (1).pdf` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/extracted/board-descriptions/Job Description_VP of Finance and Operations_2025 (1).pdf` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/extracted/board-descriptions/Job Description_VP of Marketing and Communications_2025 (1).pdf` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/extracted/job-descriptions/Job Description_Club Advisors.pdf` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/extracted/job-descriptions/Job Description_President_2026.docx` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/extracted/job-descriptions/Job Description_VP of Events and Partnerships_2026.docx` | the pilot’s own data directory — carried in the tree, never opened here |
| `Tier1/extracted/job-descriptions/Job Description_VP of Finance and Operations_2026.docx` | the pilot’s own data directory — carried in the tree, never opened here |

## Binaries

25 files by extension, 3775780 bytes in total. Largest 15:

| Path | Bytes |
| --- | --- |
| `Tier1/2026-2027 Simon's Club Transition Process  (1).pdf` | 645546 |
| `Tier1/Club Board Descriptions-selected.zip` | 644291 |
| `Tier1/Career Oriented Travel Guidance 2025-2026.pdf` | 321996 |
| `Tier1/Simon Business School Off-Campus Event Alcohol Policy (1).pdf` | 259203 |
| `Tier1/Club Board Resources - Simon Business School.pdf` | 210474 |
| `Tier1/Job Descriptions 2026-selected.zip` | 200040 |
| `Tier1/Club Board Resources - Simon Business School.Alumni Outreach.pdf` | 163541 |
| `Tier1/extracted/board-descriptions/Job Description_VP of Events and Partnerships_2025 (1).pdf` | 158965 |
| `Tier1/extracted/board-descriptions/Job Description_VP of Finance and Operations_2025 (1).pdf` | 139157 |
| `Tier1/Club Deliverables & Expectations.pdf` | 135775 |
| `Tier1/extracted/board-descriptions/Job Description_VP of Marketing and Communications_2025 (1).pdf` | 126846 |
| `Tier1/extracted/board-descriptions/Job Description_President_2025 (2).pdf` | 123510 |
| `Tier1/2026 Simon Club Deliverables & Timelines.pdf` | 112508 |
| `Tier1/SIMON BUSINESS SCHOOL CLUB EVENT REQUEST & EXECUTION GUIDE.pdf` | 110259 |
| `Tier1/extracted/board-descriptions/Job Description_Club Advisors.pdf` | 94623 |

## Large files (≥ 1048576 bytes)

None.

## Secret history indicators

Matched by path name only. No file in this list is opened by this generator or by its tests.

At the pinned commit: 1.

| Path | Why |
| --- | --- |
| `.npmrc` | may carry a registry auth token |

Ever added anywhere in the source branch's history: 1.

| Path | First added | Date | Still present | Why |
| --- | --- | --- | --- | --- |
| `.npmrc` | `a9d901bc1ed8afc8f6bfc79d45be69150018aa58` | 2026-07-30 | yes | may carry a registry auth token |

## Vulnerable dependencies

`npm audit --package-lock-only --json` against the pinned source lockfile resolved 844 dependencies and reported 13: 3 critical, 10 high, 0 moderate, 0 low, 0 info. No install was run and no lifecycle script executed; the manifest and lockfile were extracted from the pinned commit into a temporary directory and deleted afterwards.

| Package | Severity | Direct | Advisories |
| --- | --- | --- | --- |
| `@auth/core` | critical | no | `https://github.com/advisories/GHSA-7rqj-j65f-68wh` `https://github.com/advisories/GHSA-x445-f3h2-j279` `https://github.com/advisories/GHSA-xmf8-cvqr-rfgj` |
| `@auth/prisma-adapter` | critical | no | — |
| `@prisma/config` | high | no | — |
| `brace-expansion` | high | no | `https://github.com/advisories/GHSA-mh99-v99m-4gvg` `https://github.com/advisories/GHSA-rgw5-rvv9-x895` |
| `deepmerge-ts` | high | no | `https://github.com/advisories/GHSA-ggr8-5vv4-36mx` |
| `js-yaml` | high | no | `https://github.com/advisories/GHSA-5p4m-2wfm-xmqj` |
| `nanoid` | high | no | `https://github.com/advisories/GHSA-28wg-ghj8-5hjv` `https://github.com/advisories/GHSA-2v37-7h3g-55p8` |
| `next` | high | no | `https://github.com/advisories/GHSA-4633-3j49-mh5q` `https://github.com/advisories/GHSA-4c39-4ccg-62r3` `https://github.com/advisories/GHSA-68g3-v927-f742` `https://github.com/advisories/GHSA-89xv-2m56-2m9x` `https://github.com/advisories/GHSA-955p-x3mx-jcvp` `https://github.com/advisories/GHSA-m99w-x7hq-7vfj` `https://github.com/advisories/GHSA-p9j2-gv94-2wf4` `https://github.com/advisories/GHSA-q8wf-6r8g-63ch` |
| `next-auth` | critical | no | `https://github.com/advisories/GHSA-5jpx-9hw9-2fx4` `https://github.com/advisories/GHSA-7rqj-j65f-68wh` `https://github.com/advisories/GHSA-8fpg-xm3f-6cx3` `https://github.com/advisories/GHSA-x445-f3h2-j279` `https://github.com/advisories/GHSA-xmf8-cvqr-rfgj` |
| `postcss` | high | no | `https://github.com/advisories/GHSA-6g55-p6wh-862q` `https://github.com/advisories/GHSA-fxqj-rqcc-2cmp` `https://github.com/advisories/GHSA-qx2v-qp2m-jg93` `https://github.com/advisories/GHSA-r28c-9q8g-f849` |
| `prisma` | high | no | — |
| `sharp` | high | no | `https://github.com/advisories/GHSA-f88m-g3jw-g9cj` |
| `xlsx` | high | no | `https://github.com/advisories/GHSA-4r6h-8v6p-xvw6` `https://github.com/advisories/GHSA-5pgg-2g8v-p4x9` |

This is a moment, not a property: the advisory database changes under us, so the counts are
stamped with `observed_at` and the guard test does not re-derive them.

## Declared runtimes

Node end-of-life dates below come from a stated external table (`https://github.com/nodejs/release#release-schedule`, as of 2026-08-17), not from either repository. Everything else on this page is
read out of the trees.

### source

| File | Where | Declared | Times | Node major | End of life | Unsupported |
| --- | --- | --- | --- | --- | --- | --- |
| `.github/workflows/ci.yml` | workflow node-version | `20` | 3 | 20 | 2026-04-30 | **yes** |
| `apps/web/Dockerfile` | Dockerfile FROM node | `20-alpine` | 1 | 20 | 2026-04-30 | **yes** |
| `infrastructure/terraform/edge-access.tf` | terraform lambda runtime | `cloudfront-js-2.0` | 1 | — | — | no |
| `package.json` | package.json engines.node | `>=20` | 1 | 20 | 2026-04-30 | **yes** |

### target

| File | Where | Declared | Times | Node major | End of life | Unsupported |
| --- | --- | --- | --- | --- | --- | --- |
| `.github/workflows/ci.yml` | workflow node-version | `20` | 4 | 20 | 2026-04-30 | **yes** |
| `.github/workflows/visual-baselines-refresh.yml` | workflow node-version | `20` | 1 | 20 | 2026-04-30 | **yes** |
| `apps/system-studio/Dockerfile` | Dockerfile FROM node | `22-alpine` | 3 | 22 | 2027-04-30 | no |
| `apps/web/Dockerfile` | Dockerfile FROM node | `20-alpine` | 1 | 20 | 2026-04-30 | **yes** |
| `infrastructure/terraform/edge-access.tf` | terraform lambda runtime | `cloudfront-js-2.0` | 1 | — | — | no |
| `package.json` | package.json engines.node | `>=20` | 1 | 20 | 2026-04-30 | **yes** |

## Honest limits

- "Binary" is decided by extension. A text file with a binary extension would be misfiled here,
  and a binary with a `.txt` name would be missed.
- The secret-indicator lists are name-shaped. A credential pasted into a `.ts` file is not
  matched by either of them, and finding that needs a content scan this generator does not run.
- `git log --diff-filter=A` sees the branch reachable from the pinned ref. A path added on a
  branch that was never merged is not in it.
- Dependency licenses are `UNKNOWN`, not "permissive". Answering them needs a registry lookup
  per package, and this generator does not install or resolve a tree to get it.

