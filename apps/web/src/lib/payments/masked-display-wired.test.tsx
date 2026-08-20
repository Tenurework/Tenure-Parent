import fs from "fs"
import path from "path"

import { renderToStaticMarkup } from "react-dom/server"

import { MaskedNote } from "@/components/payments/MaskedNote"
import { displayPurposeFor, maskForDisplay } from "@/lib/payments/masked-display"
import type { UserContext } from "@/lib/rbac"

/**
 * PAY-200-003 — asserted on what is RENDERED and on the page that renders it.
 *
 * `masked-display.test.ts` proves the decision. A decision nothing displays is
 * not a display control, and this repository has recorded before what it costs
 * to assert on a helper that the production surface never calls. So two things
 * here:
 *
 *   1. The real `MaskedNote` — the component the approval detail page renders —
 *      is rendered to markup, and the markup is read. A masked note that
 *      dropped its notice would pass a test asserting only on the returned
 *      string.
 *   2. The approval detail page's SOURCE is read, and the two free-text fields
 *      it renders are checked to go through `maskForDisplay`. A page-level
 *      render is not available here — it is an async server component reaching
 *      NextAuth, Prisma and the tenant scope — so the wiring is asserted where
 *      it can be: the raw `{approval.description}` and `“{s.reason}”` renders
 *      that leaked the value must not come back.
 */

const PAN = "4111111111111111"
const ORG = { id: "org_robotics", institutionId: "inst_simon" }

const PAGE = path.join(
  __dirname,
  "..",
  "..",
  "app",
  "(app)",
  "approvals",
  "[id]",
  "page.tsx",
)

function context(over: Partial<UserContext> = {}): UserContext {
  return { userId: "user_reader", institutionRoles: [], orgRoles: [], ...over } as UserContext
}

describe("what the approval page puts on screen", () => {
  it("renders the mask, not the card number, for a reader with no purpose", () => {
    const decision = displayPurposeFor({
      ctx: context({
        orgRoles: [
          {
            organizationId: ORG.id,
            roleId: "role_1",
            roleName: "Member",
            scope: "MEMBER",
            status: "ACTIVE",
            templateKey: "unit.member",
          },
        ],
      }),
      org: ORG,
      subjectUserId: "user_alice",
    })
    const markup = renderToStaticMarkup(
      <MaskedNote display={maskForDisplay(`paid on the club Visa ${PAN}`, decision)} />,
    )
    expect(markup).not.toContain(PAN)
    expect(markup).toContain("paid on the club Visa")
    expect(markup).toContain("hidden entirely")
  })

  it("renders the notice as its own element, so the masked text is never read as complete", () => {
    const decision = displayPurposeFor({
      ctx: context({ userId: "user_alice" }),
      org: ORG,
      subjectUserId: "user_alice",
    })
    const markup = renderToStaticMarkup(
      <MaskedNote display={maskForDisplay(`Visa ${PAN}`, decision)} />,
    )
    expect(markup).toContain('data-testid="masked-note"')
    expect(markup).toContain('data-testid="masked-note-notice"')
    expect(markup).toContain("••••1111")
  })

  it("renders nothing at all for an absent note", () => {
    const markup = renderToStaticMarkup(
      <MaskedNote display={maskForDisplay(null, { purpose: null, because: "none" })} />,
    )
    expect(markup).toBe("")
  })

  it("renders an ordinary note unchanged and adds no notice", () => {
    const note = "Pizza for the outreach night, receipt attached."
    const markup = renderToStaticMarkup(
      <MaskedNote
        display={maskForDisplay(note, { purpose: null, because: "none" })}
      />,
    )
    expect(markup).toContain(note)
    expect(markup).not.toContain('data-testid="masked-note-notice"')
  })
})

describe("the approval detail page is on this path", () => {
  const source = fs.readFileSync(PAGE, "utf8")

  it("computes the reader's display purpose from the page's own context", () => {
    expect(source).toContain("displayPurposeFor({")
    expect(source).toContain("subjectUserId: approval.submittedById")
  })

  it("passes the request's description through the mask", () => {
    expect(source).toContain("maskForDisplay(\n      approval.description,")
  })

  it("passes every decision step's reason through the mask", () => {
    expect(source).toContain("maskForDisplay(s.reason, displayPurpose)")
  })

  it("no longer renders either field raw", () => {
    expect(source).not.toContain("{approval.description}")
    expect(source).not.toContain("“{s.reason}”")
  })
})
