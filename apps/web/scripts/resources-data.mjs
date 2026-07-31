/**
 * Launch content for the board-resource library.
 *
 * These were a hardcoded array inside the application (src/lib/resources.ts)
 * and were the only resources that could ever exist — publishing a new form
 * meant a pull request and a deploy, and the OSE Director who owns the
 * board-resource programme had no way to add one at all. They are `Resource`
 * rows now; this file is the seed that loads them, and the application reads
 * only from the database.
 *
 * `key` is the stable identifier carried over from the original array, so
 * re-seeding updates rather than duplicates and existing links keep resolving.
 *
 * Sources: Ainslie OSE club board resources, the Club Event Request &
 * Execution Guide, the Off-Campus Alcohol Policy, the Alumni Outreach process,
 * and Career Oriented Travel Guidance.
 */

export const RESOURCES = [
  // ── Everyone ───────────────────────────────────────────────────────────────
  {
    key: "simon-source",
    title: "SimonSource",
    description: "Submit event proposals, track registrations, and run event check-in.",
    href: "https://simon-rochester.12twenty.com/Login",
    external: true,
    ready: true,
    kind: "TOOL",
    seats: ["ALL"],
    rule: "Events must be submitted at least 3 weeks (21 days) in advance.",
    sortOrder: 10,
  },
  {
    key: "purchase-request",
    title: "Purchase Request / Reimbursement",
    description: "Request a club purchase or start a reimbursement.",
    href: "https://form.jotform.com/OSE_studentengagement/student-purchase-request-form",
    external: true,
    ready: true,
    kind: "FORM",
    seats: ["ALL", "VP_FINANCE"],
    rule: "Submit at least 72 hours before the purchase. Unapproved purchases are never reimbursed.",
    sortOrder: 20,
  },
  {
    key: "student-expense-form",
    title: "Student Expense Form",
    description:
      "Reimbursement submission. Combine itemized receipts and the attendee list into one PDF.",
    href: "https://form.jotform.com/OSE_studentengagement/student-expense-form-",
    external: true,
    ready: true,
    kind: "FORM",
    seats: ["ALL", "VP_FINANCE"],
    rule: 'Name the file "EER Last name, First name $xx" with the total requested.',
    sortOrder: 30,
  },
  {
    key: "merch-request",
    title: "Simon Merch Request",
    description: "Order Simon-branded merchandise and supplies through OSE.",
    href: "https://form.jotform.com/OSE_studentengagement/ainslie-ose-merch-and-supplies-purc",
    external: true,
    ready: true,
    kind: "FORM",
    seats: ["ALL", "VP_MARKETING", "VP_EVENTS"],
    rule: "Submit at least 3 business days before the event.",
    sortOrder: 40,
  },

  // ── VP Events & Partnerships ───────────────────────────────────────────────
  {
    key: "event-flyer-process",
    title: "Club Event Flyer Process",
    description: "How to get an event flyer designed, approved and distributed.",
    href: "https://padlet.com/rochester/club-board-resources-simon-business-school-aid638iawdx7os38/wish/MxrmZYkpGwJNaGOq",
    external: true,
    ready: true,
    kind: "GUIDE",
    seats: ["VP_EVENTS", "VP_MARKETING"],
    rule: null,
    sortOrder: 50,
  },
  {
    key: "event-planning-checklist",
    title: "Event Planning Checklist",
    description: "Step-by-step checklist for planning and running a club event.",
    href: "https://padlet.com/rochester/club-board-resources-simon-business-school-aid638iawdx7os38/wish/Xb8YaL47dVDwayn1",
    external: true,
    ready: true,
    kind: "CHECKLIST",
    seats: ["VP_EVENTS"],
    rule: null,
    sortOrder: 60,
  },
  {
    key: "event-request-guide",
    title: "Club Event Request & Execution Guide",
    description:
      "The full rules for submitting and running events: lead times, payment pages, check-in, food, Slack posting, merch, alumni and Net Impact.",
    href: "/resources/event-guide",
    external: false,
    ready: true,
    kind: "GUIDE",
    seats: ["VP_EVENTS", "PRESIDENT"],
    rule: "Do not promote an event until it is formally approved in SimonSource.",
    sortOrder: 70,
  },
  {
    key: "alcohol-policy",
    title: "Off-Campus Event Alcohol Policy",
    description: "Required for every off-campus event where alcohol is provided.",
    href: "/resources/alcohol-policy",
    external: false,
    ready: true,
    kind: "POLICY",
    seats: ["VP_EVENTS", "PRESIDENT"],
    rule: "Email Student Life at least 7 days before the event, even if alcohol is not the focus.",
    sortOrder: 80,
  },
  {
    key: "alumni-outreach",
    title: "Alumni Outreach & Vetting",
    description:
      "How to request contact with alumni, and when Advancement must approve the ask first.",
    href: "/resources/alumni-outreach",
    external: false,
    ready: true,
    kind: "POLICY",
    seats: ["VP_EVENTS", "PRESIDENT", "VP_MARKETING"],
    rule: "Never contact a listed alum before Diana Sipp responds.",
    sortOrder: 90,
  },
  {
    key: "travel-guidance",
    title: "Career Oriented Travel Guidance",
    description:
      "The three support tiers for career treks, what Benet provides, and what your club owns.",
    href: "/resources/travel-guidance",
    external: false,
    ready: true,
    kind: "GUIDE",
    seats: ["VP_EVENTS", "PRESIDENT"],
    rule: "De-brief with your staff coach within 10 days of the trek.",
    sortOrder: 100,
  },

  // ── VP Finance & Operations ────────────────────────────────────────────────
  {
    key: "budget-template",
    title: "Club Budget Template (Excel)",
    description:
      "The standardized budget spreadsheet for every club — fill it in, then upload it on your club's Finance tab to turn it into a live dashboard.",
    href: "/api/templates/budget",
    external: false,
    ready: true,
    kind: "FORM",
    seats: ["ALL", "VP_FINANCE", "PRESIDENT"],
    rule: "One row per category. The Total row is calculated for you and ignored on upload.",
    sortOrder: 110,
  },
  {
    key: "finance-handbook",
    title: "Club Finance Handbook",
    description:
      "Reimbursement process and turnaround, multi-club cost splits, the fiscal year, non-reimbursable expenses, and swag purchasing rules.",
    href: "/resources/finance",
    external: false,
    ready: true,
    kind: "GUIDE",
    seats: ["VP_FINANCE", "PRESIDENT"],
    rule: "Audits are due the last weekday of every month. Missing one freezes club funds.",
    sortOrder: 120,
  },

  // ── President ──────────────────────────────────────────────────────────────
  {
    key: "leadership-eligibility",
    title: "Leadership Eligibility Checklist",
    description:
      "Everything you must verify before recommending someone for a board position — and what OSE checks when confirming them.",
    href: "/eligibility",
    external: false,
    ready: false,
    kind: "CHECKLIST",
    seats: ["PRESIDENT", "OSE"],
    rule: "No leader may be announced before Ainslie OSE (and Benet CMC for professional clubs) approves.",
    sortOrder: 130,
  },
  {
    key: "transition-checklist",
    title: "Club Transition & Onboarding Checklist",
    description: "The items an outgoing and incoming board must work through together.",
    href: "/transition",
    external: false,
    ready: false,
    kind: "CHECKLIST",
    seats: ["PRESIDENT"],
    rule: "At least two joint transition meetings, plus a 1:1 for every role.",
    sortOrder: 140,
  },
  {
    key: "deliverables",
    title: "Club Deliverables & Expectations",
    description:
      "Board meeting cadence, events per mini-mester, finances, and MBA rep/MS VP appointments.",
    href: "/resources/deliverables",
    external: false,
    ready: true,
    kind: "GUIDE",
    seats: ["PRESIDENT", "ALL"],
    rule: "At least one event and two advisor meetings per mini-mester, or the budget freezes.",
    sortOrder: 150,
  },
]
