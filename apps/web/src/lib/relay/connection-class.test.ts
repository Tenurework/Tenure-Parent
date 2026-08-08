/**
 * WRK-020-001 — Bible §4.1's eight connection classes, and the escalation each
 * one refuses.
 *
 * The pure half. The half that proves the gate is REACHED — that
 * `authorizeRegistrations` consults it for every registration on every
 * `/api/ai/chat` request, ahead of the surface's ceiling and ahead of any
 * permission — is in `relay-tools.test.ts` and, through the real route, in
 * `src/app/api/ai/ai-kill-switch.test.ts`.
 */

import { CONNECTION_CLASSES, connectionClassFor } from "@tenure/platform-config"

import {
  CLASS_AUTHORITY,
  RISK_ORDER,
  leastClassFor,
  refuseEscalation,
} from "./connection-class"
import { riskExceeds } from "../relay-tools"

describe("the eight classes §4.1 names", () => {
  it("declares exactly those eight, in the Bible's own order", () => {
    expect([...CONNECTION_CLASSES]).toEqual([
      "USER_DELEGATED",
      "ADMIN_DELEGATED",
      "APPLICATION_ORG_WIDE",
      "BOT_OR_APP_INSTALLATION",
      "SERVICE_ACCOUNT",
      "WEBHOOK_ONLY",
      "FILE_OR_FEED",
      "PERSONAL_PRODUCTIVITY",
    ])
  })

  it("gives every class a ceiling drawn from the risk vocabulary, and a reason", () => {
    for (const cls of CONNECTION_CLASSES) {
      const authority = CLASS_AUTHORITY[cls]
      expect(RISK_ORDER).toContain(authority.maxRisk)
      // The reason is shown in the refusal, so an empty one is a refusal that
      // says "no" and nothing else — which is the dead end this replaces.
      expect(authority.because.length).toBeGreaterThan(20)
    }
  })

  it("shares one risk ordering with the module that derives the classification", () => {
    // Two orderings would be two answers to "is this worse than that". This is
    // the same array `riskExceeds` compares against — asserted through the
    // function rather than by importing a second copy.
    expect(riskExceeds("WRITE", "READ")).toBe(true)
    expect(riskExceeds("READ", "PRIVILEGED")).toBe(false)
    expect(RISK_ORDER.indexOf("PRIVILEGED")).toBe(RISK_ORDER.length - 1)
  })
})

describe("a webhook-only grant and an org-wide app identity are not the same thing", () => {
  it("lets a webhook-only connection read and nothing else", () => {
    // §4.1's own words: inbound signed events WITHOUT general read or write
    // authority. Anything that changes state is authority it does not carry.
    expect(refuseEscalation("WEBHOOK_ONLY", "READ").ok).toBe(true)
    for (const risk of ["DRAFT", "WRITE", "BULK", "EXTERNAL_SHARE", "DELETE", "PRIVILEGED"] as const) {
      expect(refuseEscalation("WEBHOOK_ONLY", risk).ok).toBe(false)
    }
  })

  it("lets an organization-wide application write, share and delete", () => {
    for (const risk of ["READ", "DRAFT", "WRITE", "BULK", "EXTERNAL_SHARE", "DELETE"] as const) {
      expect(refuseEscalation("APPLICATION_ORG_WIDE", risk).ok).toBe(true)
    }
    // And not take a domain-policy act: there is no person in the loop to hold
    // the domain's administrative permission.
    expect(refuseEscalation("APPLICATION_ORG_WIDE", "PRIVILEGED").ok).toBe(false)
  })

  it("is the only class that reaches a privileged act", () => {
    const privileged = CONNECTION_CLASSES.filter((c) => refuseEscalation(c, "PRIVILEGED").ok)
    expect(privileged).toEqual(["ADMIN_DELEGATED"])
  })

  it("refuses a personal connection every risk class, because it is not tenant-wide", () => {
    // §4.1 prohibits a user-owned connection from tenant-wide use outright, and
    // every relay tool is tenant-wide by construction.
    for (const risk of RISK_ORDER) {
      const verdict = refuseEscalation("PERSONAL_PRODUCTIVITY", risk)
      expect(verdict.ok).toBe(false)
      if (verdict.ok) continue
      expect(verdict.reason).toMatch(/acts for the whole tenant/)
    }
  })
})

describe("a refusal names both classes and the ceiling", () => {
  it("says what the grant is, what the tool is, and what would carry it", () => {
    const verdict = refuseEscalation("WEBHOOK_ONLY", "WRITE")

    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    // Never a boolean: the person who acts on this is an administrator changing
    // a grant, and none of these four is optional to that conversation.
    expect(verdict.grantedClass).toBe("WEBHOOK_ONLY")
    expect(verdict.requestedRisk).toBe("WRITE")
    expect(verdict.ceiling).toBe("READ")
    expect(verdict.requiredClass).toBe("SERVICE_ACCOUNT")
    expect(verdict.reason).toContain("WEBHOOK_ONLY")
    expect(verdict.reason).toContain("SERVICE_ACCOUNT")
  })

  it("names the NARROWEST class that could carry the act, not the first", () => {
    // A refusal that suggested ADMIN_DELEGATED for a WRITE would be advising an
    // administrator to grant six risk classes more than the act needs.
    expect(leastClassFor("READ")).toBe("WEBHOOK_ONLY")
    expect(leastClassFor("WRITE")).toBe("SERVICE_ACCOUNT")
    expect(leastClassFor("EXTERNAL_SHARE")).toBe("BOT_OR_APP_INSTALLATION")
    expect(leastClassFor("DELETE")).toBe("USER_DELEGATED")
    expect(leastClassFor("PRIVILEGED")).toBe("ADMIN_DELEGATED")
  })

  it("carries the ceiling on the allow path too, so a caller can report it", () => {
    const verdict = refuseEscalation("SERVICE_ACCOUNT", "BULK")
    expect(verdict).toEqual({ ok: true, grantedClass: "SERVICE_ACCOUNT", ceiling: "BULK" })
  })
})

describe("the shipped record the request path reads", () => {
  it("offers the search module under an organization-wide application identity", () => {
    // Honest: nobody consents per user and no administrator is asked per tenant
    // — the corpus is read under this platform's own identity and its results
    // are carried to the vendor under one application key.
    expect(connectionClassFor("search")).toBe("APPLICATION_ORG_WIDE")
  })

  it("says null for a module no connection serves, rather than refusing it", () => {
    // Deliberately not a refusal: a module answered entirely from this
    // platform's own store has no third party whose consent could disagree with
    // Tenure's authorization. Making the absence refuse would take every tool on
    // the platform off the air to enforce a contract no module has been given.
    expect(connectionClassFor("approvals")).toBeNull()
    expect(connectionClassFor("not-a-module")).toBeNull()
  })
})
