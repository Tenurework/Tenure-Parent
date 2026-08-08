import { renderToStaticMarkup } from "react-dom/server"

import type { ProviderReview } from "@tenure/platform-config/provider-review"

/**
 * WRK-030-005 / WRK-110-005 — asserted on the MARKUP A SURFACE EMITS.
 *
 * `capability-resolution.test.ts` proves `resolveCapability`'s table. That test
 * stays green the day a call site stops passing a derived `certified`, or the
 * day a surface stops rendering `resolved.action` — which is precisely what
 * both requirements opened on: the rule was right and nothing consumed it.
 *
 * So this renders the production component with the production resolver and
 * reads the HTML. The mutation it exists to catch is stated at each case.
 *
 * ── The one thing replaced ─────────────────────────────────────────────────
 * `RELAY_ANTHROPIC_REVIEW`, and only through a getter, so
 * `certifiedCapabilityState` reads whatever the current test set rather than a
 * value frozen at import. Everything else — `providerActivation`, the resolver,
 * the component — is the real one.
 */
const NOT_SUBMITTED: ProviderReview = {
  program: "Anthropic API — provider-side review of the Tenure Relay integration",
  state: "NOT_SUBMITTED",
  approvedScopes: [],
  verifiedAt: null,
  expiresAt: null,
}

let mockReview: ProviderReview = NOT_SUBMITTED

jest.mock("@tenure/platform-config/provider-review", () => {
  const actual = jest.requireActual<typeof import("@tenure/platform-config/provider-review")>(
    "@tenure/platform-config/provider-review",
  )
  return {
    ...actual,
    // Defined after the spread, so this wins. A plain property would be read
    // once when `capability-resolution.ts` is first imported.
    get RELAY_ANTHROPIC_REVIEW() {
      return mockReview
    },
  }
})

import {
  capabilityAdministrators,
  certifiedCapabilityState,
} from "@/lib/connections/capability-resolution"
import { MissingConnectionCard } from "./MissingConnectionCard"

/** The model connection exactly as `TenureAIPanel` and the Connection Centre build it. */
function modelCard(configured: boolean) {
  return renderToStaticMarkup(
    <MissingConnectionCard
      capability={{
        ...certifiedCapabilityState("ai.model"),
        ...capabilityAdministrators("ai.model"),
        label: "Tenure AI model",
        configured,
        reachable: true,
        connectableBy: "admin",
        requiredScopes: [],
        grantedScopes: [],
        credential: null,
        alternative: "Search your workspace — the same records, without a written answer.",
      }}
      manageHref="/messages/compose"
    />,
  )
}

const approvedReview: ProviderReview = {
  program: "Anthropic API — provider-side review of the Tenure Relay integration",
  state: "APPROVED",
  approvedScopes: ["anthropic:messages.create"],
  verifiedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
}

beforeEach(() => {
  mockReview = NOT_SUBMITTED
})

describe("what the surface says about the model connector", () => {
  it("refuses to claim a connector the provider has not reviewed is working", () => {
    // The shipped record. With a key configured, this row used to read "Tenure
    // AI model is connected and working" — about a capability
    // `/api/ai/chat` refuses to call, because the same record refuses it there.
    const html = modelCard(true)

    expect(html).toContain('data-connection-outcome="NOT_CERTIFIED"')
    expect(html).toContain('data-connection-status="Not available yet"')
    expect(html).toContain("is not a certified connection on this platform")
    expect(html).not.toContain("connected and working")
    // And no control, of any kind. A capability nobody certified cannot grow a
    // button, which is the rule WRK-030-005 is.
    expect(html).not.toContain("data-connection-action")
  })

  it("flips to a working connection the moment a real review is recorded", () => {
    // The mutation the requirement names, applied to the RECORD rather than to
    // the resolver: set the provider review to APPROVED and the surface must
    // change. Without it, the case above would pass for a component that
    // hardcodes "NOT_CERTIFIED" — and a gate that refuses everything is
    // indistinguishable from a gate that is broken.
    mockReview = approvedReview

    const html = modelCard(true)

    expect(html).toContain('data-connection-outcome="CONNECTED"')
    expect(html).toContain('data-connection-status="Ready"')
    expect(html).toContain("connected and working")
  })

  it("offers ask-an-administrator once certified but unconfigured, and a destination inside Tenure", () => {
    // WRK-110-005's ask-admin path, rendered rather than merely decided. The
    // destination is a page of Tenure: somebody who has never seen a provider
    // console must be able to finish the job.
    mockReview = approvedReview

    const html = modelCard(false)

    expect(html).toContain('data-connection-outcome="NEEDS_ADMIN"')
    expect(html).toContain('data-connection-action="ask-admin"')
    expect(html).toContain("Ask an administrator")
    expect(html).toContain('href="/messages/compose"')
    // WRK-110-005 — and it names WHICH administrator, resolved from the shipped
    // role catalog rather than from prose beside the card. "Ask an
    // administrator" with no answer to "which one" is the dead end the
    // requirement opened on.
    expect(html).toContain("platform.administrator")
    for (const leak of ["portal.azure.com", "admin center", "API key", "client secret", "developer console"]) {
      expect(html.toLowerCase()).not.toContain(leak.toLowerCase())
    }
  })
})

describe("the card renders every control the resolution can decide", () => {
  const capability = (over: Record<string, unknown>) => ({
    key: "calendar.feed",
    label: "Calendar subscription (ICS)",
    certified: true,
    configured: true,
    reachable: true,
    connectableBy: "user" as const,
    requiredScopes: [] as readonly string[],
    grantedScopes: [] as readonly string[],
    credential: null,
    ...capabilityAdministrators("calendar.feed"),
    alternative: null,
    ...over,
  })

  it("renders Disconnect for a connected per-user capability", () => {
    // The branch that did not exist anywhere in the tree before WRK-110-005:
    // `resolveCapability` has returned `disconnect` since it was written and no
    // component had a case for it, so a CONNECTED per-user feed offered
    // nothing at all.
    const html = renderToStaticMarkup(
      <MissingConnectionCard capability={capability({})} manageHref="/calendar" />,
    )

    expect(html).toContain('data-connection-action="disconnect"')
    expect(html).toContain(">Disconnect<")
    expect(html).toContain('href="/calendar"')
    expect(html).not.toContain("Connect Calendar")
  })

  it("renders Connect when the same capability is not connected", () => {
    // The contrast. Without it the case above passes for a card that always
    // prints "Disconnect".
    const html = renderToStaticMarkup(
      <MissingConnectionCard
        capability={capability({ configured: false })}
        manageHref="/calendar"
      />,
    )

    expect(html).toContain('data-connection-action="connect"')
    expect(html).toContain("Connect Calendar subscription (ICS)")
  })

  it("keeps the pending question, so a refusal is resumable", () => {
    const html = renderToStaticMarkup(
      <MissingConnectionCard
        capability={capability({ configured: false })}
        manageHref="/calendar"
        pendingIntent="what are my deadlines"
      />,
    )
    expect(html).toContain("Kept for when this connects")
    expect(html).toContain("what are my deadlines")
  })
})
