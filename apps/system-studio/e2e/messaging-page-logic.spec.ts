import { test, expect } from "@playwright/test"

import fs from "fs"
import path from "path"

import type { RuleRow } from "../src/lib/aws/eventbridge"
import type { DeadLetterState } from "../src/lib/aws/sqs"

import {
  PROCESSING_WORD,
  REACH_WORD,
  RULE_TONE,
  SECTIONS,
  disabledSchedules,
  processingAnswer,
  rankedRules,
  reachAnswer,
  sectionOrder,
} from "../src/app/platform/messaging/reach"

/**
 * `/platform/messaging` — the route, its decisions, and the two rules its files
 * have to keep.
 *
 * `layout.spec.ts` measures the page's geometry at four widths and
 * `preferences.spec.ts` measures its contrast; both need a running console.
 * This spec needs neither, because everything it asserts is either a pure
 * decision or a property of the source. It exists for the failures those two
 * cannot see:
 *
 *   * a sandbox SES account rendered as "mail works" — the highest-value fact on
 *     the page, quietly softened;
 *   * a refused `sqs:ListQueues` rendered as "nothing is waiting";
 *   * a suppressed recipient's ADDRESS reaching the page. `lib/aws/ses.ts`
 *     carries real addresses of real people on purpose, and this surface prints
 *     counts by reason and by domain instead. That is a property of the file,
 *     so it is checked in the file.
 *
 * No browser, no server, no AWS: `reach.ts` imports types plus two pure
 * renderers, so every branch runs at the node level.
 */

const ROUTE_DIR = path.join(__dirname, "..", "src", "app", "platform", "messaging")

const readSource = (file: string) => fs.readFileSync(path.join(ROUTE_DIR, file), "utf8")

/* ═════════════════════════════════════════ 1. the route is where it says ══ */

test.describe("the route", () => {
  test("is served at /platform/messaging by a page, a pure module and its own CSS", () => {
    // The path a navigation agent adds to the nav, and the path
    // `tests/architecture/shell-separation.test.mjs` will resolve against the
    // filesystem. If this directory moves, that test reds.
    expect(fs.existsSync(path.join(ROUTE_DIR, "page.tsx"))).toBe(true)
    expect(fs.existsSync(path.join(ROUTE_DIR, "reach.ts"))).toBe(true)
    expect(fs.existsSync(path.join(ROUTE_DIR, "messaging.module.css"))).toBe(true)
  })

  test("renders a card for every section the ordering can produce", () => {
    // `sectionOrder` returns ids; the page keys a record on them. A section the
    // ordering names and the page has no card for renders as nothing at all,
    // which on this page would silently drop the dead-letter panel.
    const page = readSource("page.tsx")
    for (const section of SECTIONS) {
      expect(page, `no card with id="${section}"`).toContain(`id="${section}"`)
    }
  })

  test("reads AWS only through the readers, never through the SDK", () => {
    const page = readSource("page.tsx")
    expect(page).not.toContain("@aws-sdk")
    // The Studio reads AWS and DynamoDB and never the tenant database;
    // `tests/security/operator-plane-content.test.mjs` asserts it for the whole
    // app, and this keeps the route honest on its own.
    expect(page).not.toMatch(/@prisma|PrismaClient/)
  })

  test("the page never prints a suppressed recipient's address", () => {
    const page = readSource("page.tsx")
    // `SesSuppression.entries` carries `address` and `maskedAddress` for real
    // people. The page uses `entries.length`, `byReason` and `byDomain` and
    // nothing else.
    expect(page).not.toMatch(/\.address\b/)
    expect(page).not.toMatch(/entries\.map/)
    expect(page).toContain("byReason")
    expect(page).toContain("byDomain")
  })

  test("the route stylesheet carries geometry, never a colour", () => {
    // A literal here is a pair `e2e/md3-tokens-logic.spec.ts` cannot audit, in
    // the file it is least likely to be pointed at.
    const css = readSource("messaging.module.css")
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "")
    expect(withoutComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(withoutComments).not.toMatch(/\brgba?\(/)
    expect(withoutComments).not.toMatch(/\bhsla?\(/)
    expect(withoutComments).not.toMatch(/\b(color|background|box-shadow|border-color)\s*:/)
  })
})

/* ═══════════════════════════════════ 2. the sandbox is not "mail works" ══ */

test.describe("can this platform reach people", () => {
  test("a sandbox account with a verified identity is not a green badge", () => {
    const reach = reachAnswer({
      verdict: "CAN_SEND",
      sendableFrom: ["example.invalid"],
      recipientRestriction:
        "this account is in the SES sandbox: SES delivers only to recipients that are themselves verified identities",
      why: "an identity is verified, but the account is in the sandbox",
    })
    expect(reach.verdict).toBe("REACHES_ONLY_VERIFIED")
    expect(REACH_WORD[reach.verdict]).toBe("Reaches verified addresses only")
    expect(reach.tone).toBe("bad")
  })

  test("an unreadable SES account is UNKNOWN, and never 'reaches nobody'", () => {
    const reach = reachAnswer({
      verdict: "UNKNOWN",
      why: "the SES account could not be read — refused ses:GetAccount (AccessDeniedException)",
    })
    expect(reach.verdict).toBe("UNKNOWN")
    expect(REACH_WORD[reach.verdict]).toBe("Not established")
    expect(reach.because).toContain("ses:GetAccount")
  })
})

/* ══════════════════════════ 3. a refusal is never "nothing is waiting" ══ */

test.describe("is anything queued that nobody is processing", () => {
  const denied = {
    state: "DENIED",
    capability: "sqs:ListQueues",
    action: "sqs:ListQueues",
    principal: "arn:aws:sts::123456789012:assumed-role/example-role/example-session",
    accountId: "123456789012",
    region: "example-region-1",
    partition: "aws",
    errorCode: "AccessDeniedException",
    minimumStatement: '{"Effect":"Allow","Action":"sqs:ListQueues","Resource":"*"}',
  } as const

  test("a refused queue listing is never CLEAR", () => {
    const answer = processingAnswer({
      queues: denied,
      deadLetters: { kind: "unknown", why: "the SQS queue listing was refused" },
      rows: [],
      rules: { ...denied, capability: "events:ListRules", action: "events:ListRules" },
      ruleRows: [],
    })
    expect(answer.verdict).not.toBe("CLEAR")
    expect(answer.verdict).toBe("UNKNOWN")
    expect(PROCESSING_WORD[answer.verdict]).toBe("Not established")
    expect(answer.qualifier).toContain("sqs:ListQueues")
  })

  test("a dead-letter queue holding anything is the loudest thing on the page", () => {
    const failed: DeadLetterState = {
      kind: "failed-deliveries",
      failures: [
        {
          queueName: "example-email-dlq",
          queueUrl: "https://sqs.example-region-1.example.invalid/123456789012/example-email-dlq",
          queueArn: "arn:aws:sqs:example-region-1:123456789012:example-email-dlq",
          messages: 7,
          inFlight: 0,
          sourceQueueArns: ["arn:aws:sqs:example-region-1:123456789012:example-email"],
          attribution: { kind: "shared" },
          asOf: "2026-01-01T00:00:00.000Z",
        },
      ],
      totalMessages: 7,
      unreadable: [],
    }
    const answer = processingAnswer({
      queues: denied,
      deadLetters: failed,
      rows: [],
      rules: { ...denied, capability: "events:ListRules", action: "events:ListRules" },
      ruleRows: [],
    })
    expect(answer.verdict).toBe("FAILED_DELIVERIES")
    expect(answer.hoistDeadLetters).toBe(true)
    // And the card it hoists is directly under the answer.
    expect(sectionOrder(answer)[1]).toBe("failed-deliveries")
  })
})

/* ═══════════════════ 4. a disabled schedule is a job that silently stopped ══ */

test.describe("the schedules", () => {
  const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
    name: "example-reminders",
    arn: "arn:aws:events:example-region-1:123456789012:rule/example-reminders",
    busName: "default",
    verdict: "SCHEDULED",
    detail: "a constructed rule",
    schedule: "cron(0 13 * * ? *)",
    eventDriven: false,
    state: "ENABLED",
    managedBy: null,
    description: null,
    targetsRead: {
      state: "EMPTY",
      capability: "events:ListTargetsByRule",
      asOf: "2026-01-01T00:00:00.000Z",
    },
    targetCount: 0,
    attribution: { kind: "shared" },
    ...over,
  })

  test("a disabled scheduled rule ranks above every other rule state", () => {
    const off = rule({ name: "example-off", verdict: "DISABLED", state: "DISABLED" })
    const ranked = rankedRules([
      rule({ name: "example-on" }),
      rule({ name: "example-inert", verdict: "NO_TARGET" }),
      off,
    ])
    expect(ranked[0].name).toBe("example-off")
    expect(disabledSchedules(ranked)).toHaveLength(1)
  })

  test("every rule verdict carries a tone, so none renders untoned", () => {
    // `RULE_TONE` is a total record over `RuleVerdict`; a verdict added to
    // `eventbridge.ts` and forgotten here is a compile error, and this is the
    // runtime half of that guarantee.
    for (const tone of Object.values(RULE_TONE)) {
      expect(["neutral", "info", "ok", "warn", "bad"]).toContain(tone)
    }
  })
})
