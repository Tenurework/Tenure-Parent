# NEXT SESSION — Tenure-Parent

Rewritten 2026-08-21, replacing the 2026-08-13 version wholesale (its live
branch `wip/studio-program-20260813` no longer exists on origin). Every number
here was measured on 2026-08-21, not remembered.

---

## 0. THE DIRECTIVE, BEFORE ANYTHING ELSE

**Close 900 new requirements this session. Aggressively, systematically, and in
parallel — with several branches upstream at once.**

The last session closed **25**. That is far too slow, and the reason is not the
quality bar. It is how the work was sequenced: one wave, stopped mid-run; then
one PR at a time, each waiting ~25 minutes on CI before the next began; then
four defect detours. Throughput was serialised where it did not need to be.

**Most of the remaining items are genuinely easy.** 1,889 are `FAIL`, and a
large share are FAIL only because nobody has looked at them — not because they
need new systems. Read the requirement's own sentence before assuming it is
hard; a great many are already satisfied by code that shipped and are waiting
for somebody to record the evidence.

### What to do differently — this is the whole point of this section

| Last session | This session |
|---|---|
| ONE wave of 12 agents | SEVERAL waves, launched per family, continuously |
| One PR at a time, serialised | Several branches upstream in parallel, one per family |
| 145-file PR (too big to review) | Per-family PRs, each under 100 files |
| Waited for CI before starting the next thing | Prepare the next branch while CI runs |
| Refuters ran only after everything | Refute per slice, as each slice lands |

**Parallel branches do not conflict if they are cut by FAMILY.** GE, PAY, IER,
EXT, STUDIO, SIMON, CFG, CAT, INT and WRK each own their own ledger file and
mostly their own source directories. Two agents in the same family collide on
that family's ledger; two agents in different families do not. Cut the work that
way and six PRs can be open at once.

### Where the 1,889 actually are

| Family | Open | Family | Open |
|---|---|---|---|
| GE | 781 | CFG | 79 |
| PAY | 224 | INT | 65 |
| IER | 219 | CAT | 59 |
| EXT | 186 | PACK | 53 |
| STUDIO | 167 | FIN / TTES | 34 each |
| SIMON | 157 | HCM | 33 |
| WRK | 88 | OPS | 32 |
| | | ANL / PLN | 27 each |

900 is reachable: GE alone holds 781.

---

## 1. WHERE THINGS STAND — measured 2026-08-21

`main` is **`dd8f9eb`**, green, and deployed (Deploy Studio `32445179530`).
Deployed == main == counted; there is no gap between the three.

```
2265 requirements
  PASS               345   (15.2%)
  FAIL             1,889
  BLOCKED_EXTERNAL    30
  NOT_APPLICABLE       1
  unimported           0   <- keep this at zero
```

`unimported: 0` matters as much as the 345: no requirement is invisible. If a
change drives it above zero, that is a wiring defect and it outranks new work.

Five change-sets landed 2026-08-20/21, each green before the next started:

| PR | Commit | What |
|---|---|---|
| #2 | `e23f5c8` | timeout-minutes on all CI jobs; the `--with-deps` apt hang that burned 6h |
| #3 | `6d8e6f7` | concurrency group; killed a permanent 4-skip yellow; guarded a psql glob |
| #4 | `c5ecf80` | 25 requirements; 4 silent defects |
| #5 | `4661fc8` | nav 10 sections to 8; command palette 3 to 14 destinations |
| #6 | `dd8f9eb` | a locale-dependent sort that made main red |

---

## 2. THE FIRST FIFTEEN MINUTES

```bash
cd /c/Users/satvi/Tenure-Parent
git remote -v                       # origin = Tenurework/Tenure-Parent. NEVER live.
git fetch origin && git status -sb
gh run list --branch main --limit 4  # red on main outranks everything below
node tools/document-graph.mjs        # current PASS/FAIL, and unimported must be 0
```

A red `main` outranks this entire document. It is usually cheap — most reds are
a generated artefact, not a defect. Run `npm run generate` first.

---

## 3. THE GATE — do not shorten it

`type-check` + `test:platform` IS NOT THE GATE. That subset let three failures
reach CI on 2026-08-20, and then four more defects through on the next push.

```bash
npm run generate                     # ALWAYS before test:platform
npm run type-check                   # 0 errors
npm run lint                         # CLAUDE.md names it; the CI job runs it
cd apps/web && npx jest --ci         # 373/374 (see below)
npm run test:platform                # 1241/1241
```

`npm run lint` is in CLAUDE.md's verify sequence and was omitted from the gate
actually run last session. The CI job "Lint . Type Check . Test . Build" runs
it, so a lint error is a red found late instead of early. Run it.

`npm run verify` chains these but exceeds a 10-minute tool cap — run the pieces.

**Known local-only failure:** `apps/web/src/lib/audit-append-only.test.ts` fails
on this Windows host and PASSES in CI. It proves driver pass-through by
expecting a rejection when `DATABASE_URL` is unset; this host resolves instead.
**Do not "fix" it** — calibrating a test to this machine is the defect that put
two specs green here and red in CI.

The Studio Playwright suite cannot run locally (needs DynamoDB Local; Docker is
not running). Say so rather than implying it was tested.

---

## 4. LANDMINES — each of these has already cost a red

1. **The drift ratchets.** `tests/security/workflow-drift.test.mjs` pairs
   `assert.ok(<=)` with `assert.equal(==)` on `UNPINNED_TRUSTED = 42` and
   `WORKFLOWS_WITHOUT_PERMISSIONS = 8`. Pinning an action, adding a
   `permissions:` block, or deleting a workflow reds CI unless the constant is
   lowered IN THE SAME COMMIT. Do NOT loosen them to `assert.ok` only — the
   exact-equality is deliberate, and an audit lane already proposed weakening it.

2. **ADR-0005 disarm guards.** Ten workflows carry
   `if: github.repository == 'Tenurework/Tenure'` and always skip here, enforced
   by `production-workflows-disarmed.test.mjs`. Flipping them arms five
   destructive AWS workflows against the live pilot. "Never ran" is NOT dead for
   break-glass tooling (db-recovery, rotate-auth-secret, seed-reference-data).

3. **Generated artefacts.** Many docs assert they match their generator's
   current output. Editing `package.json` can stale a doc that describes the
   build. `npm run generate` after every change, before `test:platform`.

4. **`localeCompare` in anything deterministic.** It answers by the runtime's
   collation and differs between machines. On 2026-08-21 it made main red by
   deduplicating to a different surviving record than the PR runner did. Use
   code-point comparison for any order a test, cache key or prompt depends on;
   `localeCompare` only where a human reads the result. See `byCodePoint` in
   `apps/web/src/lib/relay/evidence-assembly.ts`.

5. **Never write a raw NUL into source.** Git and ripgrep classify the file as
   binary and it stops being reviewable. Use the `\u0000` escape.

6. **Agents must not share /tmp backup paths.** In the 27-refuter wave, parallel
   agents clobbered each other's mutation backups; one only noticed via
   `git diff`. Give each agent a private path.

---

## 5. THE QUALITY BAR — and its one known blind spot

A row reaches `PASS` only with: production code by path, a caller that reaches
it, a test with real counts, and a mutation applied and OBSERVED to fail. Then
an independent refuter re-runs the mutation and re-reads the requirement's own
sentence in its authority.

This is not bureaucracy — it is the only reason the number means anything. Two
waves measured: **13 upheld / 14 overturned**, and **12 upheld / 1 overturned**.
Recording unrefuted claims once made the count say 42 where 24 were true.

**The blind spot, found the hard way:** `GE-092-004` was recorded PASS, cleared
its refuter's explicit "would this survive a different machine?" check, and
still carried the locale-dependent sort that reddened main. Mutation proof shows
a test CAN fail; it does not show the test fails the same way EVERYWHERE. When a
test asserts an order, a format or a measured number, ask what varies by host.

**Speed and this bar are not in tension.** The bar costs one refuter per claim.
What cost the last session its throughput was serialisation, not scrutiny.

---

## 6. THE HARNESS

`tools/loop/big-family-fanout.mjs` is the wave script — slices with refuters per
slice. Its rules were paid for in failures and should not be relaxed:

- Agents NEVER commit, push, or `git add`. The orchestrator commits.
- Agents NEVER write a ledger. They RETURN rows; only a CONFIRMED claim is
  written. (Eighteen claims once wrote PASS before being overturned.)
- NO SCHEMA CHANGES. Six unverified migrations had to be quarantined.
- Close TWO to SIX properly rather than fifteen shallowly.
- Prefer work provable without a build — `npm run studio:build` is ~350s.

Recover a stopped wave from `journal.jsonl` in the workflow transcript dir: each
`{"type":"result"}` line holds an agent's full return value including its
`ledger_row`. That is how the last session recovered 40 claims after a kill.

---

## 7. STUDIO UI/UX — finish the visual language to admin.google.com

**Approved direction:** take admin.google.com's *structure* — shell anatomy,
navigation tree and nesting, panels, icon vocabulary, workflows, density,
easibility. Keep Tenure's *palette*. The content is Tenure's own IP and the
Studio's real functions. Do NOT copy Google's pure white and Google Blue; the
off-white / muted-grey burn-in rule stands, with Tenure green `#198052` as the
SINGLE accent (selected nav item, primary button, focus ring, active tab) and
never flooding surfaces, page backgrounds or table headers.

### Done (PR #5)

Nav 10 groups to 8 (Identity and Data folded into AWS); command palette 3 to 14
destinations. Zero URL changes.

### Next, and mostly specified already

Full specs are committed under **`docs/handoff/specs/`**. Read them before
writing anything — they were measured, not estimated.

- **`studio-tokens-delta.md`** — THE IMPORTANT ONE. The token system ALREADY
  EXISTS: `apps/system-studio/src/app/globals.css` is 4,028 lines of complete
  MD3 two-layer tokens across four themes, accent already drawn from
  `--tenure-forest-*`, with `md3-tokens-logic.spec.ts` auditing ~100 pairs.
  **Do not write a second palette.** The work is a delta:

  - **DEFECT 1, LIVE, ships today.** `.md3-button:focus-visible` uses
    `--md-sys-color-primary`. Inside `.md3-surface[data-container="inverse"]`
    the button LABEL was re-pointed to `inverse-primary` (the comment at
    `globals.css:2860` names the reason) but **the focus ring was not**.
    `Snackbar.tsx:66` and `ToastRegion.tsx:89` both render inverse and both take
    an action button, so a keyboard operator sees a ring at **1.70:1 (light) /
    1.29:1 (dark)** against WCAG 2.2 AA 1.4.11's 3:1 floor. The audit misses it
    because no pair names `primary` on `inverse-surface`. The fix measures
    8.68 / 5.55. Add the pair to `PAIRS` so it cannot regress.
  - **No focus-ring token exists.** The ring is spelled literally at 17 sites
    across five files with FIVE different offsets. Add
    `--md-sys-color-focus-ring`, `--md-sys-color-focus-ring-inverse`,
    `--md-sys-focus-ring-width`, `--md-sys-focus-ring-offset`.
  - **DEFECTS 2 and 3, latent.** Baked state-layer alphas disagree with the
    opacity tokens the audit composites at; `--md-sys-state-pressed` is
    referenced by zero rules. Delete it and assert baked alpha equals the
    opacity token. Add `on-surface-variant` to `INTERACTIVE` before a hoverable
    row renders secondary text on `surface-container-highest`.

- **`admin-console-reference.md`** — the reference. Its IA is MEASURED: 2,191
  literal `Menu > A > B > C` strings harvested from 1,890 official help
  articles. Its pixel values are Material 3's published tokens, NOT measurements
  of Google's console — `admin.google.com` 302s to a bot check and could not be
  fetched, and `m3.material.io` is an SPA with no fetchable body. Honour that
  distinction; do not tell anyone a number is "what admin.google.com does" on
  the strength of the M3 sections.
  Shell facts worth building to: persistent collapsible drawer (not a rail),
  hamburger top-left, **in-place accordion disclosure, not flyout**, a Pinned
  section capped at 5, per-category icons, unified top-bar search whose results
  resolve to NAV COORDINATES rather than just pages.
  NOTE: this repo deliberately keeps palette pins UNBOUNDED
  (`commands-logic.spec.ts`: "an operator who pins twenty things meant to").
  Do not copy Google's cap of 5 over that decision.

- **`studio-routing-ia.md`** — Phase 2 is specified but NOT recommended: it
  moves 17 of 18 routes and touches 40 e2e specs, 4 guards and 4 docs, and
  `next.config.ts` declares no `redirects()`, so a moved URL is a hard 404. Do
  not start it without redirects.
  Genuinely missing operator surface: an **approval inbox** (Bible "Changes").
  Lifecycle advances require approvals today with no queue, plan diff or inbox.

- **`studio-shell-audit.md`** — what exists today, file by file.

---

## 8. LIVE AWS IN THE STUDIO — a wiring job, not a build

The machinery is COMPLETE: `/api/aws/[surface]`, the `x-aws-refresh-ms` header,
`lib/aws/refresh.ts` (the polling loop) and `components/LiveRegion.tsx`. It is
wired to **2 of 11 platform pages** and **11 of ~45 readers** in
`apps/system-studio/src/lib/aws/`.

Pages are `force-dynamic`, so they are live AT LOAD and frozen after. Register
the remaining readers as live surfaces in `SURFACES` (`lib/aws/result.ts` —
`capability: null` means NOT live) and add `LiveRegion` per page. That is what
makes an AWS change appear without a reload.

---

## 9. SES — machine mail, and the one change that can break the company

Specs: `docs/handoff/specs/ses-target-architecture.md` and
`ses-current-state.md`.

Two namespaces that must never mix:

- **Human, Google Workspace, apex `@tenurework.com`** — 28 live addresses: 2
  users (`satvik@`, `almamy@`), 8 groups (`finance@`, `legal@`, `operations@`,
  `partnerships@`, `security@`, `support@`, `team@`, `technical@`) and 18
  aliases. Application email NEVER sends from the apex.
- **Machine, SES, SUBDOMAINS ONLY** — `auth.tenurework.com`,
  `notify.tenurework.com`, `reply.tenurework.com` (opaque signed tokens
  `r+<token>@`, never raw ids), MAIL FROM on DEDICATED `bounce.auth.` and
  `bounce.notify.`.

Reply-To must be validated against the real 28, not guessed: **`billing@` is an
alias of `finance@`** and **`integrations@` is an alias of `technical@`**.

**The apex MX/SPF/DMARC belong to Google Workspace and carry the company's live
human email.** Get those records wrong and the company's mail breaks, not just
the app's. Terraform and the sender module can be written and reviewed freely;
**DNS records must be shown to the user before anything is applied.**

---

## 10. BLOCKED ON THE USER — record these, do not idle on them

- **No AWS credentials locally.** AWS CLI v2.36.28 is installed but
  `sts get-caller-identity` returns NoCredentials. Nothing in SES or live-AWS
  can be verified against account `154932391697` until `aws configure` or
  `aws sso login`. Suggest the user run it with the `!` prefix.
- **Greptile is out of credits** (50-credit trial cap). It reviewed PRs #2 and
  #3, then stopped; PR #4 — the largest of the session — merged with no bot
  review. **CodeRabbit is installed and working**, and earned it: on PR #5 it
  caught a rail destination still unreachable from the palette AND a `grep`
  command that would hang, the latter being a defect in a fix made minutes
  earlier.
- `up-dbrec.yml` and `sim.sh` sit untracked in the repo root. They predate this
  work; nobody has said whether they are wanted. Do not commit them.

---

## 11. PARKED

`wip/relay-model-picker` (`90777f2`, unpushed) — ten Bedrock models a tenant can
choose as its answer model, with every `modelId` and region read off the model
card twice by independent agents. Blocked on a DELIBERATE TRIPWIRE: adding a
Bedrock model to `MODEL_CATALOG` trips
`tests/architecture/int-connector-capability-matrix.test.mjs` — "a Bedrock model
appeared in the catalog — §6 of the matrix needs rewriting, and INT-080-004
revisiting". It also trips `no-hardcoded-estate.test.mjs`, because the per-model
region lists are region literals inside `packages/`. Both are real obligations
the repo set on purpose; resolve them, do not bypass them.

Traps already paid for on that branch: **Claude 5.x model ids carry NO date and
NO `-v1:0` suffix** (`anthropic.claude-opus-5`), and four of the ten cannot be
invoked by base id at all — they need a cross-region inference profile.
