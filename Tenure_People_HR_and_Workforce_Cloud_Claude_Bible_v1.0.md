# Tenure People, HR, and Workforce Cloud Bible

**Version:** 1.0  
**Date:** 2026-08-04  
**Status:** Binding first-party core-system architecture and Claude Code execution specification  
**Ambition:** Best memory-first global people system for employee-, member-, volunteer-, student-, contingent-, and position-centric organizations  

---

## BEGIN CLAUDE CODE MASTER PROMPT

You are the principal HCM product architect, global HRIS architect, workforce-management engineer, privacy/security lead, employment-data architect, UX lead, integration architect, test lead, and hands-on implementation owner for **Tenure People Cloud**.

Build People Cloud as a first-party core Tenure system—not a thin employee directory and not a collection of provider links. It must combine the depth expected from global HCM with Tenure's distinguishing organizational-memory model: a person has private history and rights; a durable position/seat retains eligible role knowledge, obligations, work context and successor handoff. Never confuse the two.

“Best” is not a claim in UI or marketing until measurable release gates pass. It means faster and safer lifecycle execution, lower HR/manager/employee friction, stronger authority and privacy, historically correct workforce truth, exceptional successor continuity, transparent automation, global configurability, interoperability and proven usability.

## 1. Constitutional boundaries

Read the Tenure Constitution/document graph, Architecture Bible, Configurator Bible, Pack Factory, Integration Bible, Finance, Planning and Operations Bibles, and ERP Implementation Extension. This Bible owns People Cloud domain semantics. Payroll uses exact-scope modes and certification; identity authentication remains Cognito/federation; IT/device changes execute through certified integrations.

All Tenure runtime remains in Tenure-owned AWS. No customer-specific source forks.

## 2. Core people model

Keep distinct:

- `Person` — natural person identity resolution and privacy subject.
- `Worker` — employment/contingent relationship to a legal employer.
- `Member` — organizational membership not necessarily employment.
- `Candidate` — recruiting relationship with purpose-limited data.
- `Dependent`/`Beneficiary` — separately protected related-person data.
- `Job` — reusable work classification.
- `Position` — budgeted/authorized slot in an organization.
- `Seat` — durable organizational responsibility and institutional-memory anchor; may map to a position, elected role, volunteer role, committee role or service identity.
- `Assignment` — effective-dated relationship placing a person into worker/member/position/seat context.
- `Delegation` — temporary scoped authority, not a new assignment.

Private person data never automatically becomes successor memory. Seat memory contains eligible work artifacts, decisions, responsibilities, controls, playbooks, relationships and status, with privacy filtering and provenance.

## 3. Required domain families

### 3.1 Enterprise and workforce structures

- Legal employer, reporting establishment, business unit, department, cost center, location, union/collective group and legislative grouping.
- Job family, job, grade, grade ladder/rate, position, headcount/FTE budget and position hierarchy.
- Matrix, dotted-line, project, functional, supervisory and community relationships.
- Effective-dated reorganizations with preview, approvals, overlap/gap rules, historical reconstruction and downstream Finance/Planning/Identity impact.

### 3.2 Core HR and employment lifecycle

- Hire, rehire, convert, transfer, promote, demote, change manager/location/job/grade/FTE, add concurrent assignment, place on leave, suspend, terminate, rescind, reverse and correct.
- Country/legal-employer specific required data and documents through jurisdiction packs.
- Employment contracts, probation, seniority, service dates, worker categories and collective agreements where applicable.
- Mass actions with preview, sampling, approval, idempotency, per-record outcome and rollback/correction.
- Future-dated changes and as-of reporting.

### 3.3 Recruiting and candidate experience

- Requisition, position/headcount/funding check, approval, posting, source, candidate, application, screening, interview, assessment, offer, background check/provider, prehire and conversion.
- Consent/purpose/retention controls and candidate deletion/anonymization.
- Structured interview plans, scorecards, conflicts, fairness monitoring and accessible candidate UX.
- No autonomous hiring/rejection; Relay assists with transparent evidence and human decisions.

### 3.4 Onboarding, transitions and offboarding

- Preboarding, documents, forms, attestations, training, equipment/access requests, payroll/benefit provider tasks, manager/buddy plans and milestone readiness.
- Seat handoff plan generated from eligible role memory, open work, recurring obligations, access, relationships and decisions.
- Incoming/shadow/outgoing overlap states.
- Offboarding covers work transfer, records, final tasks, access/device revocation, provider notifications, retention and exit case.
- Never transfer another person's private messages, performance, health, compensation or unrestricted files to a successor.

### 3.5 Time, attendance, scheduling and absence

- Work patterns, shifts, availability, time zones, DST, calendars, clocks/imports, timesheets, projects, premiums, overtime, breaks, exceptions and approvals.
- Leave types, eligibility, accrual, balance, request, certification reference, intermittent leave, carryover, expiry and return-to-work.
- Exact jurisdiction/collective-agreement rules as versioned packs; no universal hard-coded policy.
- Corrections, retro impact and payroll-provider reconciliation.

### 3.6 Compensation

- Salary/hourly/rate, allowances, bonuses, commission targets, equity references, pay ranges and total rewards.
- Compensation cycles, budgets, guidelines, proposals, calibration, approvals, letters and downstream payroll.
- Pay equity and range analytics with appropriate privacy, explanations and human review.
- Effective dating, currency/FX, proration, retro and audit.

### 3.7 Benefits

- Plan/program/options, eligibility, enrollment windows, life events, coverage, dependents/beneficiaries, employer/employee costs and carrier/provider exchange.
- Evidence/document handling and privacy partitioning.
- No native benefit administration claim for a geography without exact provider/legal/certification readiness.

### 3.8 Talent, performance, goals, skills and succession

- Goal alignment, check-ins, feedback, reviews, calibration, development plans, talent pools, potential/performance grids, succession slates and readiness.
- Skills/competencies/licenses/certifications/languages and expiry.
- Job/position/seat requirement profiles separate from person profiles.
- Learning catalog, assignment, enrollment, completion, assessment and compliance training.
- Bias/access safeguards; private talent judgments never become broadly inherited seat memory.

### 3.9 Employee relations, HR cases and workplace

- Confidential HR case intake, classification, assignment, SLA, investigation artifacts, actions and closure.
- Grievance, accommodation, return-to-work, policy question and workplace incident under exact privacy/access rules.
- Conflict-of-interest and whistleblower safeguards.
- Facilities/desk/workplace/visitor dependencies through Operations and integrations.

### 3.10 Payroll boundary

Modes: `UNAVAILABLE`, `EXPORT_ONLY`, `PROVIDER_ORCHESTRATED`, `SHADOW`, `TENURE_NATIVE_CERTIFIED` for exact legal entity/population/jurisdiction. Model payroll relationships, elements/inputs, run, calculation result, validation, approval, payment/filing handoff, provider acknowledgement, settlement and reconciliation. Never imply that a generated file equals paid or filed.

## 4. Canonical objects

At minimum: `Person`, `Name`, `ContactPoint`, `Worker`, `EmploymentRelationship`, `Assignment`, `Job`, `JobFamily`, `Position`, `Seat`, `Grade`, `GradeRate`, `Location`, `WorkPattern`, `CollectiveAgreement`, `Candidate`, `Requisition`, `Application`, `Interview`, `Offer`, `OnboardingJourney`, `TransitionPlan`, `TimeEntry`, `TimeCard`, `Shift`, `AbsencePlan`, `AbsenceBalance`, `LeaveRequest`, `CompensationElement`, `CompensationCycle`, `BenefitPlan`, `Enrollment`, `Goal`, `Review`, `Feedback`, `Skill`, `Profile`, `LearningItem`, `LearningAssignment`, `SuccessionPlan`, `HRCase`, `PayrollRelationship`, `PayrollInput`, `PayrollRunReference`, `WorkforceEvent`.

Every sensitive object has classification, purpose, access policy, retention, legal hold, effective time, correction history and audit.

## 5. State and command integrity

Implement explicit state machines for requisition, candidate/application, offer, assignment, onboarding, timecard, leave, compensation cycle, benefit enrollment, review, learning, HR case and payroll exchange.

Commands validate active legal employer, position/headcount/funding, policy, authority, effective dates, incompatible changes, required documents, privacy purpose and downstream impact. Use idempotency and optimistic concurrency. Corrections preserve prior truth; never overwrite history.

## 6. Authorization and privacy

- Deny-by-default action-resource-scope policy with person, worker, seat, relationship, legal employer, organization, geography, purpose and effective date.
- Employees see their permitted data; managers see only authorized teams and fields; HR roles are duty-separated; compensation/medical/relations/recruiting data use narrower domains.
- Cross-tenant and unauthorized cross-legal-employer access tests are mandatory.
- Field-level redaction is enforced server-side and in exports/search/analytics/Relay.
- Support access is case-bound, time-limited, approved, minimized and audited.
- Privacy rights/export/correction/deletion/retention are evaluated against employment, tax, legal hold and regulatory obligations.

## 7. People experience

### Employee/member hub

Profile, assignments, pay/provider links where permitted, time, leave, benefits, goals, learning, tasks, documents, cases, organization, role memory and Relay. Use one prioritized action inbox; avoid menu sprawl.

### Manager workspace

Team, positions, vacancies, headcount/budget, approvals, time/leave, goals, development, compensation cycles, onboarding/offboarding and organizational health. Every metric has definition, freshness, population and drill-through.

### HR operations

Workforce structures, transactions, mass actions, data quality, cases, compliance, provider exchange, policy, security and audit. Effective-date timeline and compare are first-class.

### Recruiter/candidate

Accessible, mobile-friendly, transparent status and communications. Internal recruiter workbench has requisitions, pipeline, interviews, offers, blockers and SLAs.

All surfaces use Tenure Experience System, save/resume, drafts, back/forward, conflict recovery, accessible errors, light/dark/compact/comfortable modes and localization.

## 8. Institutional-memory superiority

People Cloud must outperform conventional HCM on transitions:

1. Detect upcoming vacancy/term end/leadership transition.
2. Build role continuity map from authorized work.
3. Identify responsibilities, recurring cycles, approvals, relationships, risks and open commitments.
4. Separate person-private data from inheritable seat context.
5. Assign outgoing/incoming/manager/HR actions.
6. Track transfer completeness and missing knowledge.
7. Grant time-bound shadow access under policy.
8. Deliver successor onboarding in priority order with citations.
9. Preserve the transition itself as evidence and improve future playbooks.

Simon student-leadership transitions are the proving case, but the model must work for executive, finance-controller, plant-manager, recruiter, project-lead and volunteer roles.

## 9. Integrations

Use the Integration Plane for identity/SCIM, payroll, benefits, recruiting, background check, time clocks, learning content, tax, bank, finance, device/app access, productivity and analytics. Exact source of truth is configured per domain. Provider schemas never control Tenure canonical data.

## 10. Relay in People Cloud

Allowed examples: explain policy with citations, draft job/requisition, summarize permitted team trends, prepare onboarding plan, identify expiring certifications, answer role-history questions, draft manager communications and propose workflows.

Forbidden: autonomous hire/fire/pay decision; infer protected traits; expose private employee/candidate data; rank candidates or employees without reviewed lawful design; approve compensation/payroll; bypass purpose/access. Every tool is typed, scoped, logged and risk-gated.

## 11. Analytics and planning bridge

Provide historically correct headcount/FTE, vacancy, movement, span/layer, workforce cost, skills, time, absence, recruiting funnel, onboarding, retention and succession measures. Definitions and effective-date semantics are canonical. Planning consumes governed workforce actuals and writes approved plans—not hidden duplicate HR master data.

## 12. Globalization

Jurisdiction packs define required fields, document types, employment/leave/time/payroll/retention rules, translations and certifications. Exact local legal review remains human-owned. Names, addresses, gender/identity fields, national identifiers, calendars, currencies, time and language must be configurable and respectful; do not impose a US-only model.

## 13. Best-system scorecard

Do not claim superiority until benchmark evidence includes:

- employee/manager task success, time-on-task and error rate;
- HR transaction cycle time and correction rate;
- onboarding readiness and days-to-productivity;
- transition knowledge completeness and successor search time;
- data-quality defects, effective-date errors and unauthorized access rate;
- payroll/provider variance and unresolved exceptions;
- accessibility completion across representative users;
- configuration-to-live time without source forks;
- integration reliability and reconciliation;
- support cases per active workforce and time to resolve;
- release adoption, rollback and uptime/SLO;
- comparison against defined workflows from Workday/Oracle/SAP/Rippling/Intuit Enterprise Suite using lawful black-box/public evidence, never copied trade dress. Intuit scenarios must include payroll/time-to-project accounting, HR/onboarding, benefits-provider experience and adoption speed.

## 14. Required E2E scenarios

1. Position-funded requisition → recruit → offer → hire → identity/device/payroll tasks → seat onboarding.
2. Effective-dated transfer across department/legal employer with Finance/Planning/identity consequences.
3. Manager change and reorganization with historical reporting.
4. Time/leave correction with payroll-provider retro reconciliation.
5. Compensation cycle with budget, calibration, SoD and letters.
6. Benefit life event with confidential dependent data and provider exchange.
7. Performance/skills/learning/succession with privacy boundaries.
8. Confidential HR case denying unauthorized manager/support access.
9. Termination/offboarding with access revoke and seat-memory handoff.
10. Simon board transition plus a corporate role transition from the same engine.
11. Tenant suspension/offboarding/privacy request.
12. Provider outage and reauthorization without data loss.

## 15. Evidence-gated checklist

### HCM-000 — Foundation

- [ ] HCM-000-001 — Inventory current people/member/seat/role/onboarding logic and false HCM claims.
- [ ] HCM-000-002 — Implement distinct person/worker/member/job/position/seat/assignment models and migrations.
- [ ] HCM-000-003 — Implement effective-dated workforce structures and historical reconstruction.
- [ ] HCM-000-004 — Import every `HCM-*` item into the canonical ledger.
- [ ] HCM-GATE-000 — Core people truth is correct and tenant-safe.

### HCM-010 — Lifecycle and organization

- [ ] HCM-010-001 — Implement full worker/member assignment transaction families and corrections.
- [ ] HCM-010-002 — Implement position/headcount/FTE/funding controls and reorganizations.
- [ ] HCM-010-003 — Implement onboarding, transition, overlap and offboarding journeys.
- [ ] HCM-010-004 — Implement mass actions with preview, approval, idempotency and per-record outcome.
- [ ] HCM-GATE-010 — Workforce change is effective-dated, controlled and recoverable.

### HCM-020 — Talent acquisition and development

- [ ] HCM-020-001 — Implement requisition-to-hire with consent, retention and accessible candidate UX.
- [ ] HCM-020-002 — Implement goals, feedback, reviews, calibration and development.
- [ ] HCM-020-003 — Implement skills/profiles/licenses, learning and succession.
- [ ] HCM-020-004 — Pass fairness/privacy/human-decision guardrails.
- [ ] HCM-GATE-020 — Talent lifecycle works without unsafe automated judgment.

### HCM-030 — Time, leave, compensation, benefits and payroll boundary

- [ ] HCM-030-001 — Implement time/schedule/attendance and exception controls.
- [ ] HCM-030-002 — Implement absence eligibility/accrual/balance/request/correction.
- [ ] HCM-030-003 — Implement compensation elements/cycles/budgets/guidelines/approvals.
- [ ] HCM-030-004 — Implement benefit eligibility/enrollment/provider contracts.
- [ ] HCM-030-005 — Implement exact payroll capability modes, run exchange and reconciliation.
- [ ] HCM-GATE-030 — Workforce value flows are exact-scope, controlled and reconciled.

### HCM-040 — Privacy, UX, memory and Relay

- [ ] HCM-040-001 — Enforce field/domain/purpose-level authorization across API/UI/search/export/analytics/Relay.
- [ ] HCM-040-002 — Deliver employee, manager, HR, recruiter and candidate experiences with WCAG 2.2 AA.
- [ ] HCM-040-003 — Implement private-person versus inheritable-seat memory boundary and transition experience.
- [ ] HCM-040-004 — Implement safe People Relay tools and evaluations.
- [ ] HCM-040-005 — Pass long-session, localization, mobile and visual-regression tests.
- [ ] HCM-GATE-040 — People Cloud is safe, humane and memory-first.

### HCM-050 — Global, integration, operations and superiority

- [ ] HCM-050-001 — Implement jurisdiction-pack applicability and truthful availability.
- [ ] HCM-050-002 — Certify enabled identity/payroll/benefits/recruiting/time/learning integrations.
- [ ] HCM-050-003 — Pass all twelve E2E scenarios, isolation, performance, DR and provider-failure tests.
- [ ] HCM-050-004 — Instrument the best-system scorecard and record baseline/target/results.
- [ ] HCM-050-005 — Publish exact supported capability/jurisdiction/provider matrix and limitations.
- [ ] HCM-GATE-050 — Superiority is claimed only where measured evidence passes.

## 16. Definition of done

People Cloud is done only for the exact enabled scope when full workforce structures and lifecycle, employee/manager/HR experience, privacy, time/leave/compensation/benefit/payroll boundaries, talent, integrations, analytics, Relay and transition memory work end to end; all evidence gates pass; and unbuilt jurisdictions/capabilities remain unavailable.

## 17. Prohibited shortcuts

Do not merge person and seat; expose private data to successors; use email/title/Cognito group as HR authority; overwrite history; hard-code country rules; call payroll/provider work complete without reconciliation; let Relay hire/fire/pay/approve; show biased vanity analytics; copy competitor UI; or claim best without benchmark evidence.

## 18. Required final Claude response

Report enabled HCM scope, legal entities/jurisdictions/providers, E2E flows, privacy/isolation results, accessibility/usability metrics, transition-memory outcomes, test counts/failures/skips, deployments, limitations, blockers and rollback state.

## END CLAUDE CODE MASTER PROMPT

---

## Reference anchors

- Workday HCM overview: <https://www.workday.com/en-us/topics/hr/human-capital-management-software.html>
- Oracle global HR/workforce structures: <https://docs.oracle.com/en/cloud/saas/human-resources/fahbo/overview-of-loading-work-structures.html>
- Oracle position/FTE reporting semantics: <https://docs.oracle.com/en/cloud/saas/human-resources/faohb/Workforce-Management-Position-Real-Time-SA-229.html>
- Rippling HR/IT/Finance platform: <https://www.rippling.com/products>
- Intuit Enterprise Suite payroll/HR/project connection: <https://quickbooks.intuit.com/r/news/intuit-enterprise-suite-new-era-of-growth/>
