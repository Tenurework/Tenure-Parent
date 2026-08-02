# Retiring a long-lived AWS access key

GE-011-006. What has to be true before a key is disabled, and what to do when
disabling it turns out to have been wrong.

**Nothing in this repository disables a key.** `tools/key-last-use.mjs` reads
`iam:GetAccessKeyLastUsed` and reports; every step below is performed by a human
who has read the report. That separation is the point of the item: GE-011-004
moved the read path to OIDC and deliberately did **not** revoke what it
replaced, because surprise-revoking a credential breaks whatever was quietly
depending on it — and the thing quietly depending on it is almost never the
thing you were thinking about.

---

## Before disabling anything

**1. Take the inventory, and keep it.**

```bash
node tools/key-last-use.mjs --json > key-inventory-$(date -u +%Y%m%d).json
```

The report is evidence for a decision made later. A disable that turns out to
break something needs to be explainable, and "we looked and it seemed unused"
is not explainable without the thing you looked at.

**2. Read what "no recorded use" actually means.**

AWS reports `N/A` when it has no record — and it began recording in 2015 and
does not record every service. `noRecordedUse` therefore means *AWS has no
record*, not *nobody used it*. It is the category that most needs a human, not
the one that is safest to act on. The report orders it first for that reason.

**3. Find what holds the key, not just what used it.**

Last-use tells you a key was used; it does not tell you by what. Check at least:

- `.github/workflows/*.yml` — every job naming `secrets.ACCESSKEYID` or
  `secrets.SECRETACCESSKEY`. `tests/security/oidc-trust.test.mjs` carries a
  ratchet listing exactly these, and the list may only shrink.
- Repository and environment secrets: `gh secret list --repo satvikOS/Tenure-Parent`
- The pilot repository, separately: `gh secret list --repo satvikOS/Tenure`
- Any operator machine, CI outside GitHub, or third-party service that was ever
  given a key. This one cannot be enumerated from here and is why step 4 exists.

**4. Replace before you remove.**

The OIDC role that supersedes the key must already be working — a green run
that used it, not a role that exists. `aws-inventory.yml` run `30701877182` is
the shape of that evidence: it printed `principal type: assumed-role` from its
own output.

---

## Disabling

Deactivate first. **Never delete first** — deactivation is reversible in one
command and deletion is not reversible at all.

```bash
# Deactivate. Reversible.
aws iam update-access-key \
  --user-name <user> --access-key-id <AKIA…> --status Inactive

# Watch for at least one full business cycle — a week, not an afternoon.
# Anything that used the key on a weekly schedule will not fail until it runs.
```

If something breaks:

```bash
aws iam update-access-key \
  --user-name <user> --access-key-id <AKIA…> --status Active
```

Only after a quiet observation period, and only for a key whose last recorded
use predates it:

```bash
aws iam delete-access-key --user-name <user> --access-key-id <AKIA…>
```

---

## What must be recorded

For each key retired, in `docs/decisions/` alongside this file:

- The inventory snapshot the decision was made from.
- What was found to be holding it, and what replaced it.
- When it was deactivated, and by whom.
- The observation window, and what was watched during it.
- When it was deleted, if it was.

A retirement with no record is one nobody can reverse and nobody can defend.

---

## Current state

Fourteen workflows still authenticate with long-lived keys; the ratchet in
`oidc-trust.test.mjs` lists them and may only shrink. **No key has been
retired.** The inventory tool exists so that when one is, it is a decision with
evidence behind it rather than a guess — and the guess is the failure mode this
document is written against.
