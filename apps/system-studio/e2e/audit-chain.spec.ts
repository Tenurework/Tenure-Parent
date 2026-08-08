import { execFileSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"

import { test, expect, type Page } from "@playwright/test"

import { operatorFor } from "./operator-identity"

/**
 * STUDIO-110-005 / STUDIO-060-010 — the audit chain, against a real DynamoDB.
 *
 * ## What this proves that a unit test cannot
 *
 * `verifyChain` has a thorough unit test over hand-built records. What no unit
 * test can show is the thing the requirement is actually about: that a row
 * EDITED IN THE TABLE, behind the application's back, comes back through the
 * reader and is reported to an operator by sequence. Every layer has to hold —
 * the writer's hashing, the DynamoDB round trip (a document client marshals and
 * unmarshals, and a chain whose hash does not survive that is not a chain), the
 * reader, the verifier and the page.
 *
 * So this drives the console through a browser to WRITE the chain, tampers with
 * a row through `tools/dev/tamper-audit-row.mjs` — which is outside the app
 * because the Studio's own IAM policy denies it UpdateItem on `AUDIT#…` — and
 * drives the console again to read the break.
 *
 * ## And puts it back
 *
 * The tamper is restored at the end, so the platform chain is intact for the
 * next run. A suite that leaves a permanently broken chain behind reports a
 * false red the second time it runs, which is the worst kind.
 *
 * Skipped without a table, and skipped loudly: a spec that quietly passes when
 * the database is absent is worse than none, because the requirement would cite
 * it.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""
const configured = !!process.env.TENANT_TABLE && !!process.env.AWS_ENDPOINT_URL_DYNAMODB

/** The estate-wide chain. `PLATFORM_PARTITION` in src/lib/audit-ledger.ts. */
const PARTITION = "PLATFORM"

/** Unique per run: the ledger is append-only, so a fixed id collides on re-run. */
const RUN = process.env.GITHUB_RUN_ID ?? Date.now().toString(36)

const REPO_ROOT = path.resolve(__dirname, "../../..")

function tamperTool(...args: string[]): string {
  return execFileSync("node", ["tools/dev/tamper-audit-row.mjs", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
  })
}

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForLoadState("networkidle")
}

async function openAudit(page: Page) {
  await page.goto("/platform/audit")
  await expect(page.getByRole("heading", { name: "Audit", level: 1 })).toBeVisible({
    timeout: 20_000,
  })
}

/** How many records the page says this chain holds, or 0 when it holds none. */
async function recordCount(page: Page): Promise<number> {
  const row = page.getByTestId(`chain-${PARTITION}`)
  if ((await row.count()) === 0) return 0
  const cells = await row.locator("td").allTextContents()
  return Number(cells[1])
}

/**
 * Place a legal hold through the UI.
 *
 * Chosen as the act to record because it is the one whose whole purpose is the
 * audit trail — and because it writes an intent row and an outcome row through
 * exactly the same ledger every other act uses. Nothing here injects a record.
 */
async function placeHold(page: Page, id: string, reason: string) {
  await openAudit(page)
  await page.selectOption("#place-partition", PARTITION)
  await page.fill("#place-holdId", id)
  await page.fill("#place-reason", reason)
  await page.getByRole("button", { name: "Place the hold" }).click()
  await expect(page.getByTestId(`hold-${id}`)).toBeVisible({ timeout: 20_000 })
}

test.describe("the audit chain, written and verified against a real DynamoDB", () => {
  test.skip(!configured, "needs TENANT_TABLE and AWS_ENDPOINT_URL_DYNAMODB")

  test("records acts as a chain, reports a tampered row by sequence, and plans retention without performing it", async ({
    page,
  }) => {
    await signIn(page)
    await openAudit(page)

    const before = await recordCount(page)

    // ── Three acts, six chained rows ────────────────────────────────────
    //
    // Each placement writes an INTENT row before it acts and an OUTCOME row
    // after — the ordering STUDIO-060-010 is about. Three of them, because a
    // chain of one proves nothing about linking and a tamper needs a MIDDLE.
    await placeHold(page, `chain-a-${RUN}`, "First preservation order for the chain test.")
    await placeHold(page, `chain-b-${RUN}`, "Second preservation order for the chain test.")
    await placeHold(page, `chain-c-${RUN}`, "Third preservation order for the chain test.")

    await openAudit(page)
    const after = await recordCount(page)
    expect(after, "three audited acts must add six chained rows").toBe(before + 6)

    // Intact, as written.
    await expect(page.getByTestId(`verdict-${PARTITION}`)).toHaveText("intact")
    await expect(page.getByTestId("chain-verdict")).toHaveText("intact")

    // The holds the acts placed are on the page, and the retention plan is a
    // PLAN: it names what expiry would cover and deletes nothing.
    await expect(page.getByTestId(`retention-${PARTITION}`)).toBeVisible()
    await expect(page.getByTestId("retention-plan")).toContainText("nothing is deleted")

    // ── The concurrency condition ───────────────────────────────────────
    //
    // A second writer claiming a position that is already written must be
    // refused by the DATABASE. Without that, the loser of a race silently
    // replaces the winner, one act disappears, and the chain still verifies.
    const middle = after - 3
    const refusal = tamperTool("duplicate", "--partition", PARTITION, "--sequence", String(middle))
    expect(refusal, "a duplicate sequence must be refused by the conditional put").toContain(
      "ConditionalCheckFailedException",
    )

    // ── Tamper with the middle row ──────────────────────────────────────
    const backup = path.join(os.tmpdir(), `tenure-audit-backup-${RUN}.json`)
    try {
      const tampered = tamperTool(
        "tamper",
        "--partition",
        PARTITION,
        "--sequence",
        String(middle),
        "--backup",
        backup,
      )
      expect(tampered).toContain("tampered")

      await openAudit(page)

      // The verdict flips, and it names the sequence rather than saying
      // "something is wrong".
      await expect(page.getByTestId(`verdict-${PARTITION}`)).toHaveText("BROKEN")
      const break_ = page.getByTestId(`break-${PARTITION}-${middle}`)
      await expect(break_).toBeVisible()
      await expect(break_).toHaveAttribute("data-break-reason", "CONTENT_ALTERED")

      // Nothing was deleted by any of this. The count is unchanged, which is
      // what distinguishes an edit from a removal on this page.
      expect(await recordCount(page)).toBe(after)
    } finally {
      // Put it back, so the next run starts from an intact chain.
      const restored = tamperTool("restore", "--backup", backup)
      expect(restored).toContain("restored")
      fs.rmSync(backup, { force: true })
    }

    await openAudit(page)
    await expect(page.getByTestId(`verdict-${PARTITION}`)).toHaveText("intact")

    // ── And a row REMOVED, which an edit cannot look like ────────────────
    //
    // The half a per-row hash cannot answer, and the whole reason the records
    // are chained: every surviving row still hashes correctly, and only the
    // sequence and its successor's link say anything happened.
    const removed = path.join(os.tmpdir(), `tenure-audit-removed-${RUN}.json`)
    try {
      tamperTool("remove", "--partition", PARTITION, "--sequence", String(middle), "--backup", removed)

      await openAudit(page)
      await expect(page.getByTestId(`verdict-${PARTITION}`)).toHaveText("BROKEN")
      await expect(page.getByTestId("gap-table")).toBeVisible()
      const link = page.getByTestId(`break-${PARTITION}-${middle + 1}`)
      await expect(link).toBeVisible()
      await expect(link).toHaveAttribute("data-break-reason", "BROKEN_LINK")
    } finally {
      const restored = tamperTool("restore", "--backup", removed)
      expect(restored).toContain("restored")
      fs.rmSync(removed, { force: true })
    }

    await openAudit(page)
    await expect(page.getByTestId(`verdict-${PARTITION}`)).toHaveText("intact")
    expect(await recordCount(page)).toBe(after)
  })

  test("a legal hold keeps records the retention window would otherwise expire", async ({
    page,
  }) => {
    // `applyRetention` is called with the holds actually on record, not with the
    // empty default. This is what makes that visible: with a zero-day retention
    // window every record is past retention, and the only thing that can keep
    // one is a hold.
    test.skip(
      process.env.AUDIT_RETENTION_DAYS !== "0",
      "needs AUDIT_RETENTION_DAYS=0 so every record is past retention",
    )

    await signIn(page)
    await placeHold(page, `retention-${RUN}`, "Everything on this chain is preserved.")

    await openAudit(page)
    const cells = await page.getByTestId(`retention-${PARTITION}`).locator("td").allTextContents()
    const heldBack = Number(cells[3])
    expect(heldBack, "an unscoped hold preserves every record past retention").toBeGreaterThan(0)
    await expect(page.getByTestId("held-back-table")).toBeVisible()
  })
})
