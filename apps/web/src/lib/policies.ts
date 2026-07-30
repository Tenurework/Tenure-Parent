/**
 * Institutional policy content, transcribed from the Ainslie OSE documents.
 *
 * Stored as structured data rather than prose pages so the same content can
 * be rendered, searched, and cited by Tenure AI from one source. Hard rules
 * are separated from guidance because they carry consequences — a missed
 * lead time gets an event denied, a missed audit freezes a club's budget.
 *
 * Every policy names the document it came from. If OSE republishes, update
 * here and the page, the search index, and the AI answers all move together.
 */

import type { SeatKey } from "./resources"

export type PolicySection = {
  heading: string
  /** Intro prose for the section */
  body?: string
  /** Ordered or unordered points */
  items?: string[]
  /** Non-negotiables, rendered with emphasis */
  rules?: string[]
}

export type Policy = {
  slug: string
  title: string
  summary: string
  /** Source document name, shown so the rule is traceable */
  source: string
  /** Caveat about the source, e.g. it self-dates to an earlier year */
  sourceNote?: string
  seats: SeatKey[]
  sections: PolicySection[]
  contacts?: { name: string; role?: string; email?: string }[]
}

export const POLICIES: Policy[] = [
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: "event-guide",
    title: "Club Event Request & Execution Guide",
    summary:
      "How to submit, fund, promote and run a club event — including every lead time you have to hit.",
    source: "Simon Business School Club Event Request & Execution Guide",
    sourceNote:
      "The source document states it reflects policy as of the 2024-2025 academic year. Confirm with your advisor before relying on it for a 2026-2027 event.",
    seats: ["VP_EVENTS", "PRESIDENT"],
    sections: [
      {
        heading: "Lead times",
        body: "Every deadline below is counted backwards from the event date.",
        items: [
          "21 days (3 weeks) before — submit the event in SimonSource. Applies to on- and off-campus, free and paid.",
          "7 days before — for off-campus events with alcohol, email Student Life with the venue point of contact and confirmation of policy compliance.",
          "3 business days before — submit the Simon Merch Request form.",
          "72 hours before — coordinate with your OSE advisor to use the OSE business card for food.",
          "72 hours before the purchase — submit the reimbursement request form. This is before the purchase, not before the event.",
          "Within 1 week after — submit the Net Impact form.",
        ],
        rules: [
          "Events submitted fewer than 21 days before the intended date may not be approved.",
          "Do not promote or assume approval for an event until it is formally approved in SimonSource.",
          "Failure to adhere to this guide may result in delays, budget denials, or event ineligibility.",
        ],
      },
      {
        heading: "What your SimonSource submission must include",
        items: [
          "Title, date, time, location",
          "Event description and target audience",
          "Expected attendance",
          "Technology needs",
          "Food plans",
          "Full budget — funding sources and spending estimates",
          "Venue contact information (off-campus events)",
          "Merchandise flag and alcohol flag",
          "Zoom or platform details for virtual and hybrid events",
          "Co-sponsors and the funding split, if cost is shared",
        ],
      },
      {
        heading: "Payment and check-in",
        rules: [
          "Events cannot charge fees or collect payment through external tools such as Venmo, Eventbrite, or Zelle.",
          "When a fee applies, students do not register directly on SimonSource — registration goes through the payment page link, and payers are then added to the attendee list.",
          "All events must use SimonSource for student check-in. The QR code must be displayed and used at the event; it is required for funding tracking, compliance, and Net Impact records.",
        ],
      },
      {
        heading: "Food and the business card",
        rules: [
          "OSE can assist in placing orders for delivery only. Food pickups are not supported by the OSE team.",
          "Food purchases without advisor coordination will not be permitted on the business card.",
        ],
      },
      {
        heading: "Reimbursements",
        rules: [
          "All reimbursements require prior written approval.",
          "Unapproved purchases will not be reimbursed under any circumstances.",
        ],
      },
      {
        heading: "Slack posting",
        body: "Route posts by audience: club members only goes to the club channel, program-specific goes to that program's channel, and the full Simon community goes to #events only.",
        rules: [
          "Do not post the same event in multiple channels.",
          "You are limited to three total posts in #events per event, and only one of those may be on the day of the event.",
        ],
      },
      {
        heading: "Technology, merch and alumni",
        items: [
          "OSE staff will not be available on-site to troubleshoot technology or AV. Arrive early to test.",
          "Unclaimed merch may be redistributed to other events at OSE's discretion.",
          "Confirm alumni names and graduation years as soon as alumni attendance is finalized, for Simon Advancement records.",
          "OSE will not coordinate internal budget records between groups — record inter-club financial splits yourselves.",
        ],
      },
      {
        heading: "Net Impact form",
        rules: [
          "One form must be completed per event, regardless of size or scope.",
          "Submitting the form is required to be eligible for end-of-year funding awards and recognition.",
        ],
      },
      {
        heading: "Communication expectations",
        rules: [
          "Notify your OSE advisor immediately of any change to timing, format, cost, or venue.",
          "Event changes without notice may result in revoked approvals or budget penalties.",
        ],
      },
    ],
    contacts: [
      { name: "Gina Ignatti", role: "Ainslie OSE — food and business card" },
      { name: "Brittany Grage", role: "Ainslie OSE — food and business card" },
      { name: "Kam McMillian", role: "Ainslie OSE — food, business card, invoices" },
      { name: "Alex Wilks", role: "Student Life — alcohol event notifications" },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: "alcohol-policy",
    title: "Off-Campus Event Alcohol Policy",
    summary:
      "Required for all off-campus events where alcohol is provided. Board members are accountable for enforcement.",
    source: "Simon Business School Off-Campus Event Alcohol Policy",
    seats: ["VP_EVENTS", "PRESIDENT"],
    sections: [
      {
        heading: "Before the event",
        rules: [
          "A club board member must email the Student Life team at least 7 days before the event with the venue point of contact and confirmation that the venue will comply with this policy.",
          "This email is required even if alcohol is not the primary focus of the event.",
        ],
      },
      {
        heading: "The seven rules",
        items: [
          "No outside alcohol or illegal substances — students are prohibited from bringing outside alcohol or illegal substances into the venue.",
          "Event check-in — no student will be admitted into the event after the specified check-in time.",
          "Drink tickets — clubs may provide a maximum of 2 drink tickets per student, valid for beer, wine, seltzer, cider, and non-alcoholic beverages only.",
          "Prohibited beverages — clubs may only offer beer, wine, seltzer, cider, and non-alcoholic beverages. Students wanting hard liquor or mixed drinks must purchase these at their own expense. Shots are not allowed.",
          "No smoking or vaping indoors — regardless of venue policies.",
          "Event end time — students must vacate the venue promptly at the scheduled end time.",
          "Club board responsibility — see below.",
        ],
      },
      {
        heading: "Board member responsibility",
        body: "Club board members sponsoring the event are responsible for crowd control and for ensuring student conduct aligns with the Simon Code of Conduct.",
        rules: [
          "If unprofessional behaviour is observed that violates Simon's Code of Conduct, #SimonStrong values, or the Simon Business School brand, board members must take appropriate action, including removing the offending individual from the event.",
          "Such incidents must be reported to the Ainslie Office of Student Engagement immediately and may result in serious consequences.",
        ],
      },
    ],
    contacts: [
      {
        name: "Ainslie Office of Student Engagement",
        role: "2-202 Schlegel Hall · 585-275-8163",
        email: "Studentengagment@simon.rochester.edu",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: "alumni-outreach",
    title: "Alumni Outreach & Vetting",
    summary:
      "How to request contact with alumni. Some alumni cannot be contacted until Advancement approves the specific ask.",
    source: "Club Board Resources — Simon Business School: Alumni Outreach (Club Leader Version)",
    seats: ["VP_EVENTS", "PRESIDENT", "VP_MARKETING"],
    sections: [
      {
        heading: "1. Research and identify",
        body: "Students are responsible for researching and identifying the alumni they wish to contact, and should source names independently before seeking assistance from club advisors.",
      },
      {
        heading: "2. Check with your advisor first",
        rules: [
          "Once you have identified alumni, you must check with your advisor(s) to see if the contact is already known.",
          "The club advisor must verify the alum's name against the Request to Contact List and the Vetting Alumni Ask Policy.",
        ],
        items: [
          "Advisors also weigh in on whether the alum is being considered for other club or Benet CMC programming.",
        ],
      },
      {
        heading: "3a. If the alum is NOT on the list",
        items: [
          "You may proceed with outreach using messaging approved by your advisor.",
          "Club leaders manage ongoing communication; best practice is to cc the club advisor for awareness.",
          "Advisors notify Diana Sipp that outreach has been made and by which club.",
        ],
      },
      {
        heading: "3b. If the alum IS on the Request to Contact List",
        body: "Contact Diana Sipp directly, with your club advisor cc'd, including full details of the ask: type of event, proposed date and time, event description, and exactly what you are asking of the alum.",
        rules: [
          "No outreach may occur before Diana responds.",
        ],
        items: [
          "Diana replies with one of three outcomes: proceed with the ask, Advancement facilitates the ask, or the request is denied before any outreach occurs.",
        ],
      },
      {
        heading: "4. Tracking and reporting",
        items: [
          "The club advisor adds the alum to the alumni engagement tracking sheet once confirmed, and reports back to Advancement when the event concludes.",
        ],
      },
    ],
    contacts: [
      {
        name: "Diana Sipp",
        role: "Associate Director of Engagement",
        email: "dsipp@simon.rochester.edu",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: "travel-guidance",
    title: "Career Oriented Travel Guidance",
    summary:
      "The three support tiers for career treks — what Benet provides, what your club owns, and what is never covered.",
    source: "Career Oriented Travel Guidance 2025-2026",
    seats: ["VP_EVENTS", "PRESIDENT"],
    sections: [
      {
        heading: "Before anything else",
        rules: [
          "All treks must follow the formal proposal and approval process.",
          "Staff presence is not guaranteed and depends on existing Simon business travel.",
        ],
      },
      {
        heading: "Tier 1 — Career treks (staff-supported, school-aligned)",
        body: "Treks that align with Simon or University of Rochester business needs, and may be eligible for staff support if staff are already travelling for related purposes. Examples: Simon or UR-hosted alumni and employer events, national conferences such as NBMBAA or ROMBA, and cities where Benet Center staff already have scheduled meetings.",
        rules: [
          "Staff attendance is not guaranteed — only considered if it overlaps with institutional travel.",
          "Students must submit a formal proposal, outline goals, and attend preparation meetings.",
          "Final approval comes from the Assistant Dean of the Benet Center.",
          "A Simon staff coach (e.g. your club advisor) must be identified.",
        ],
      },
      {
        heading: "Tier 2 — Club group experience (no staff travel)",
        body: "Club-organized treks that do not align with institutional travel priorities but still offer valuable career exploration. Same Benet resource support and the same club responsibilities as Tier 1, without staff travel.",
      },
      {
        heading: "Tier 3 — Individual or small group (fully student-led)",
        body: "Student-initiated visits for company tours, informational interviews, or career research. Same guidance as Tier 2 for templates, outreach support and coaching.",
        rules: ["No use of club funds or staff travel is allowed."],
      },
      {
        heading: "What Benet provides (Tiers 1 and 2)",
        items: [
          "Alumni and employer contacts",
          "Outreach templates and best practices",
          "One-on-one coaching",
        ],
      },
      {
        heading: "Your club's responsibilities",
        items: [
          "All logistics, planning and expenses are managed by students",
          "Club funds may be requested through proper channels",
          "A Simon staff coach must be identified",
        ],
      },
      {
        heading: "Required deliverables",
        items: [
          "A written trip plan — itinerary, costs, company and alumni visits",
          "A post-trip written reflection and feedback",
          "A de-brief meeting with your staff coach within 10 days of the trek",
        ],
      },
      {
        heading: "Considerations",
        items: [
          "Company readiness — Benet may advise against visiting companies experiencing hiring freezes or layoffs, and can redirect toward more fruitful opportunities.",
          "Virtual options — when in-person travel isn't feasible, Benet is happy to support or co-host virtual treks.",
          "Cost and inclusion — out-of-pocket costs can be significant. Plan treks that are financially accessible to all members.",
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: "finance",
    title: "Club Finance Handbook",
    summary:
      "Reimbursements, audits, the fiscal year, what can never be reimbursed, and swag purchasing rules.",
    source: "Ainslie OSE VP of Finance guidance",
    seats: ["VP_FINANCE", "PRESIDENT"],
    sections: [
      {
        heading: "Reimbursement process",
        items: [
          "Verify the student has a separate payment election set up in Workday.",
          "Provide the club member with the Student Expense Form link.",
          "Submission must include a digital copy of the original itemized receipt(s) and the attendee list.",
          "All documents must be combined into a single PDF and uploaded to the JotForm.",
        ],
        rules: [
          'The file must be named "EER Last name, First name $xx", where the dollar amount is the total reimbursement requested.',
        ],
      },
      {
        heading: "Reimbursement timeline and etiquette",
        rules: [
          "Reimbursements must be submitted by Thursday at 11:59 PM to be processed that Friday.",
          "Submissions after this deadline will not be processed until the following Friday.",
          "Expect a two-week turnaround from the Friday the reimbursement is processed.",
        ],
        items: [
          "If you submitted past the deadline, do not follow up until two weeks from the Friday of the next week.",
        ],
      },
      {
        heading: "Splitting cost between multiple clubs",
        items: [
          "The form includes a section for cost splits when partnering with multiple clubs.",
          "Confirm the splits with the student before they submit — specify how much each club reimburses from its budget.",
          "The amounts entered in the form determine the final split.",
          "All other steps are the same as a single-club reimbursement.",
        ],
      },
      {
        heading: "Never reimbursable",
        items: [
          "Travel insurance",
          "Items without a receipt",
          "Cash prizes",
          "Gift cards and Visa gift cards",
          "Uber and Lyft",
          "EBT or other benefits cards / payment methods",
        ],
      },
      {
        heading: "Fiscal year and reporting",
        items: [
          "The University of Rochester fiscal year runs July 1 – June 30.",
          "Reports are released for the prior month — March reports arrive in April.",
          "Reports are available during the second week of each month.",
          "Not all monthly charges appear immediately; timing depends on when invoices or reimbursements are processed.",
        ],
        rules: [
          "Because charges lag, you must track your budget independently rather than relying on the monthly report alone.",
        ],
      },
      {
        heading: "Audits",
        body: "Audits are due on the last weekday of each month. All eight due dates for this academic year are on your Tenure calendar.",
        rules: [
          "Failure to submit by the due date will result in frozen club accounts.",
        ],
      },
      {
        heading: "Club swag purchasing",
        rules: [
          "Clubs may not fully cover swag purchases — members must pay at least 50% out of pocket.",
          "All purchases must be approved by Gina Ignatti, Brittany Grage, or Kam McMillian before ordering items or paying invoices.",
        ],
        items: [
          "A payment page can be requested for swag purchases.",
          "Clubs are responsible for distributing apparel, not Ainslie OSE.",
        ],
      },
    ],
    contacts: [
      { name: "Kam McMillian", role: "Ainslie OSE — send all invoices here" },
      { name: "Gina Ignatti", role: "Ainslie OSE — swag approval" },
      { name: "Brittany Grage", role: "Ainslie OSE — swag approval" },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: "deliverables",
    title: "Club Deliverables & Expectations",
    summary:
      "The recurring commitments every board carries: meetings, events, finances, and fall appointments.",
    source: "Club Deliverables & Expectations",
    seats: ["ALL", "PRESIDENT"],
    sections: [
      {
        heading: "Board meetings",
        rules: [
          "Boards are required to meet at least twice per mini-mester, with club advisor(s) invited to attend.",
        ],
        items: [
          "Consider meeting bi-weekly.",
          "Prepare an agenda in advance and take meeting notes.",
          "Meet in person whenever possible.",
        ],
      },
      {
        heading: "Events",
        rules: [
          "Clubs are required to host at least one event per mini-mester. Failure results in the club's budget being frozen.",
          "All events must be submitted in SimonSource at least three weeks in advance for approval.",
          "Events must be included in the club's approved business plan. New events not in the original plan require additional approval from your club advisor(s).",
        ],
      },
      {
        heading: "Simon alumni",
        rules: [
          "Inviting Simon alumni to an event requires following the Alumni Outreach & Vetting process in coordination with your club advisor(s).",
        ],
      },
      {
        heading: "Club finances",
        body: "The VP of Finance is responsible for completing a monthly audit, assisting with student reimbursements, and sending all invoices to Kam McMillian.",
        rules: ["Failure may result in freezing of club funds."],
      },
      {
        heading: "MBA reps and MS VP positions",
        items: [
          "In the fall, clubs interview and appoint one first-year MBA representative and two MS VPs.",
          "Treat these as meaningful leadership positions and integrate them intentionally into the board.",
        ],
      },
    ],
  },
]

export function policyBySlug(slug: string): Policy | undefined {
  return POLICIES.find((p) => p.slug === slug)
}

/** Flattened text for the search index and AI retrieval. */
export function policyText(policy: Policy): string {
  const parts = [policy.title, policy.summary]
  for (const s of policy.sections) {
    parts.push(s.heading)
    if (s.body) parts.push(s.body)
    if (s.items) parts.push(...s.items)
    if (s.rules) parts.push(...s.rules)
  }
  return parts.join("\n")
}
