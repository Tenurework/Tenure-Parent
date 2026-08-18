# Existing form and configuration code — retain, refactor, migrate or retire

**CFG-000-003.** One disposition for every form or configuration module in the
tree, with the reason and something a reader can open.

The left-hand column is not a list somebody typed. It is exactly the set
`configurationModules()` computes in `tools/cfg-configuration-truth.mjs` — the
same derivation the CFG-000-001 inventory uses, so the two cannot disagree about
what counts as configuration code.
`tests/architecture/cfg-form-disposition-covers-the-tree.test.mjs` compares the
two sets in **both** directions: a module added to the tree with no disposition
reds, and a disposition for a module that no longer exists reds. That is what
separates a mapping from a paragraph — remove one row below and the guard goes
red naming it.

## What the four words mean here

| Disposition | Meaning |
|---|---|
| `RETAIN` | This is the target design. The declarative configurator is built **on** it, not around it. Changes will be additive. |
| `REFACTOR` | The module keeps its responsibility and must change shape to satisfy a named `CFG-*` requirement. It stays where it is. |
| `MIGRATE` | The module's content must move to a different owner — a schema package, the shared component kit, or the declarative form vocabulary. The file as written does not survive the move. |
| `RETIRE` | Superseded by something that already exists; delete once the caller is moved. |

**No module is `RETIRE` today, and that is a finding rather than an oversight.**
`RETIRE` is the disposition for code whose replacement has landed. `CFG-010`
(schema package registry) and `CFG-020` (declarative schema and rule runtime)
are unbuilt — every row in this ledger below `CFG-000` is `FAIL` — so nothing
here has been superseded by anything. A disposition table that retired modules
against a replacement nobody has written would be describing a repository that
does not exist, which is the specific failure this programme keeps having.

## The configuration engine — `packages/configuration`

The layered, governed configuration engine. `CFG-020` asks for a declarative
schema and rule runtime; this is the half of it that exists, and it exists with
the properties the bible asks for rather than merely the name.

| Module | Disposition | Why | Evidence |
|---|---|---|---|
| `packages/configuration/src/index.ts` | RETAIN | The package facade. The CFG-020 vocabularies are additions to this surface, not a replacement for it. | `packages/configuration/src/index.ts` |
| `packages/configuration/src/definition.ts` | RETAIN | `ConfigDefinition`, `SENSITIVITIES` and `ConfigRegistry` are the structural vocabulary CFG-020-001 names, including the classification that drives CFG-020-003's redaction rule. | `packages/configuration/src/definition.ts` |
| `packages/configuration/src/domains.ts` | RETAIN | Every definition carries which layer may write it. That is CFG-020-003's mapping-and-authority rule, already enforced. | `packages/configuration/src/domains.test.ts` |
| `packages/configuration/src/scopes.ts` | RETAIN | The precedence order the whole resolution depends on. Sixty-seven lines and no CFG requirement contradicts it. | `packages/configuration/src/scopes.ts` |
| `packages/configuration/src/resolve.ts` | RETAIN | Resolution with per-value attribution to the layer it came from — CFG-020-004's provenance requirement in its existing form. | `packages/configuration/src/resolve.ts` |
| `packages/configuration/src/merge.ts` | RETAIN | Merge strategy is declared on the definition rather than inferred from the value's shape, which is what keeps a graph evaluation deterministic. | `packages/configuration/src/merge.ts` |
| `packages/configuration/src/version.ts` | RETAIN | A published configuration is immutable and a change produces a new version. CFG-050's branch and compare work needs exactly this. | `packages/configuration/src/version.ts` |
| `packages/configuration/src/layer-schema.ts` | RETAIN | Versioned layer metadata — signer, origin, compatibility range, effective interval, approval. This is the record CFG-010-001's package lifecycle attaches to. | `packages/configuration/src/layer-schema.test.ts` |
| `packages/configuration/src/layer-bridge.ts` | RETAIN | Resolution through the versioned schema rather than through a bare value bag. | `packages/configuration/src/layer-bridge.test.ts` |
| `packages/configuration/src/integrity.ts` | RETAIN | Digest and signature checking over layer metadata — the mechanism CFG-010-002's admission check needs, one level down. | `packages/configuration/src/integrity.test.ts` |
| `packages/configuration/src/expression.ts` | RETAIN | CFG-020-002 asks for bounded parsing, static typing, dependency extraction and deterministic evaluation. This module exports `parse`, `typeOf`, `dependencies`, `expressionCycles` and `evaluate` — all four, with limits. | `packages/configuration/src/expression.test.ts` |
| `packages/configuration/src/rejections.ts` | RETAIN | Ambiguous precedence, module-graph cycles, unsafe expressions and unentitled features are already refused with reasons — CFG-010-003's actionable errors. `UNIMPLEMENTED_REJECTIONS` names the ones that are not, honestly. | `packages/configuration/src/rejections.ts` |
| `packages/configuration/src/publication.ts` | RETAIN | `lint`, `renderDiff`, `simulate` and `planPublication` are CFG-040's preview, impact and approval gate in the shape they already exist. | `packages/configuration/src/publication.test.ts` |
| `packages/configuration/src/authority.ts` | RETAIN | The five non-bypassable guardrails. CFG-020-003's lock rule cannot be built on anything weaker. | `packages/configuration/src/authority.test.ts` |
| `packages/configuration/src/exceptions.ts` | RETAIN | The reviewed path for what the guardrails refuse — the half that stops a guardrail becoming a reason to bypass the whole engine. | `packages/configuration/src/exceptions.test.ts` |
| `packages/configuration/src/store.ts` | RETAIN | `commit` is the one writer, and `tests/security/one-config-writer.test.mjs` reds if a second appears. CFG's configurator must publish through it. | `tests/security/one-config-writer.test.mjs` |
| `packages/configuration/src/graph.ts` | RETAIN | The graph algorithms Bible §11 steps 6 and 8 and §16 need, in one place: `minimalCyclePaths`, `topologicalGroups`, `affectedSubgraph`. RETAIN rather than REFACTOR because it replaced two duplicate depth-first searches rather than adding a third — `expression.ts` and `rejections.ts` both delegate to it now. | `packages/configuration/src/graph.test.ts` |
| `packages/configuration/src/graph-snapshot.ts` | RETAIN | Bible §11's ten compilation steps, the traced evaluator, affected-subgraph re-evaluation and the two §11-step-10 projections. This is what CFG-030-001, -002, -003 and -005 and CFG-020-004 are recorded against, and CFG-020-001's missing vocabularies are additions to `RULE_SLOTS` here rather than a second compiler. | `packages/configuration/src/graph-snapshot.test.ts` |
| `packages/configuration/src/registry-graph.ts` | RETAIN | The bridge that gives the compiled graph its nodes: every `ConfigDefinition` becomes a `DeclaredNode` under its owner's namespace, and the flags that already decide enablement and applicability imperatively (`overridable`, `requiresCapability`, `liveOnly`) become the rules that decide them declaratively. Keys the four scalar types cannot carry are NAMED, not dropped. | `packages/configuration/src/registry-graph.test.ts` |

## What the platform makes configurable — `packages/platform-config`

The question set a configurator asks is derived from these definitions. They are
retained because the alternative — a schema package that redeclares locale,
flags, modules and branding — is the parallel settings store `one-config-writer`
exists to prevent.

| Module | Disposition | Why | Evidence |
|---|---|---|---|
| `packages/platform-config/src/index.ts` | RETAIN | Both the tenant application and the Studio need one answer to "what can be configured". | `packages/platform-config/src/index.ts` |
| `packages/platform-config/src/definitions.ts` | RETAIN | The terminology keys that used to be literals in components. A configurator question maps onto one of these, not onto a new key. | `packages/platform-config/src/definitions.ts` |
| `packages/platform-config/src/resolve.ts` | RETAIN | Effective configuration for one institution, layered lowest-precedence-first. | `packages/platform-config/src/resolve.test.ts` |
| `packages/platform-config/src/modules.ts` | RETAIN | Which modules an institution runs and the navigation that follows. CFG-030's capability questions read this. | `packages/platform-config/src/modules.test.ts` |
| `packages/platform-config/src/flags.ts` | RETAIN | A flag may only restrict, never grant. That law is what stops a configurator toggle becoming a second authorization system. | `packages/platform-config/src/flags.test.ts` |
| `packages/platform-config/src/experiments.ts` | RETAIN | Experiments on top of the restrict-only law, so an experiment cannot grant either. | `packages/platform-config/src/experiments.test.ts` |
| `packages/platform-config/src/exposure.ts` | RETAIN | Exposure telemetry — the half that says how many people a rollout actually reached. | `packages/platform-config/src/exposure.test.ts` |
| `packages/platform-config/src/localization.ts` | RETAIN | Locale, currency and calendar as configuration. CFG-030 asks the country question; this is where its answer lands. | `packages/platform-config/src/localization.test.ts` |
| `packages/platform-config/src/direction.ts` | RETAIN | Text direction derived from the writing system rather than offered as a preference. A configurator must not ask this, and this module is why. | `packages/platform-config/src/direction.test.ts` |
| `packages/platform-config/src/business-calendar.ts` | RETAIN | Working days, which every configurator deadline and approval SLA has to count in. | `packages/platform-config/src/business-calendar.test.ts` |
| `packages/platform-config/src/branding.ts` | RETAIN | Visual identity as configuration rather than as hex literals in a stylesheet. | `packages/platform-config/src/branding.test.ts` |
| `packages/platform-config/src/compatibility.ts` | RETAIN | Whether a published configuration can run on the engine version a cell has. CFG-010-001's engine-range check is the same question one level up. | `packages/platform-config/src/compatibility.test.ts` |
| `packages/platform-config/src/money.ts` | RETAIN | Currency formatting with no dependencies, kept separate so a cell can format money without importing the resolver. Integer minor units throughout. | `packages/platform-config/src/money.ts` |
| `packages/platform-config/src/model-entry.ts` | RETAIN | The shape of an allowed-model entry, declared where a cell can read it without importing the control plane. | `packages/platform-config/src/model-entry.ts` |
| `packages/platform-config/src/model-policy.ts` | RETAIN | The models Relay may invoke, as an allowlist rather than an environment variable. | `packages/platform-config/src/model-policy.ts` |
| `packages/platform-config/src/provider-review.ts` | RETAIN | The provider's side of an integration as an activation gate. CFG-030's integration questions must not be answerable past it. | `packages/platform-config/src/provider-review.test.ts` |
| `packages/platform-config/src/build-system.ts` | RETAIN | One assembly of an organization system from its parts. A second assembly is how a tenant's preview and production drift apart. | `packages/platform-config/src/build-system.ts` |

## The Studio's configurator surfaces — `apps/system-studio`

This is the configurator and deployer UX the bible is about. It exists, it is
two-step, and it is nothing like declarative: which fields appear is decided by
a 1,240-line page component.

| Module | Disposition | Why | Evidence |
|---|---|---|---|
| `apps/system-studio/src/app/tenants/[slug]/configuration/page.tsx` | REFACTOR | 1,240 lines that assemble the editable fields in a page component. CFG-020-004 requires a client-safe presentation projection generated from one graph snapshot — same responsibility, different shape. | `apps/system-studio/src/app/tenants/[slug]/configuration/page.tsx` |
| `apps/system-studio/src/app/tenants/[slug]/configuration/ConfigurationEditor.tsx` | REFACTOR | Renders fields it is handed as props. It must render the projection instead, so visibility, enablement and validation come from the rule graph rather than from the page that built the props. | `apps/system-studio/src/app/tenants/[slug]/configuration/ConfigurationEditor.tsx` |
| `apps/system-studio/src/app/tenants/[slug]/configuration/actions.ts` | REFACTOR | The two-step review/publish path is right in kind and already authorizes through `authorizeCommand`. CFG-050 adds a branch and an environment to every publication, which this signature does not carry. | `apps/system-studio/src/app/tenants/[slug]/configuration/actions.ts` |
| `apps/system-studio/src/lib/editable-config.ts` | REFACTOR | Derives what may be edited from the domain registry. CFG-010 requires editability to come from an admitted, versioned schema package — the derivation survives, its source changes. | `apps/system-studio/src/lib/editable-config.ts` |
| `apps/system-studio/src/lib/config-store.ts` | RETAIN | The DynamoDB adapter behind the port `@tenure/configuration` declares. The engine still refuses to know where records live. | `apps/system-studio/src/lib/config-store.ts` |
| `apps/system-studio/src/lib/config-sort-key.ts` | RETAIN | Pure string padding for the revision sort key, testable without a server. | `apps/system-studio/src/lib/config-sort-key.ts` |
| `apps/system-studio/src/app/tenants/[slug]/configuration/change-cost.ts` | RETAIN | What a configuration change does to the bill, quoted rather than charged. CFG-040 treats a cost estimate as an external check, which is what this is. | `apps/system-studio/src/app/tenants/[slug]/configuration/change-cost.test.ts` |
| `apps/system-studio/src/app/tenants/[slug]/configuration/RollbackControls.tsx` | RETAIN | Rollback republishes forward as a new revision and the wording says so. CFG-060's rollback UX asks for exactly that honesty. | `apps/system-studio/src/app/tenants/[slug]/configuration/RollbackControls.test.tsx` |
| `apps/system-studio/src/app/tenants/[slug]/configuration/consequences.ts` | RETAIN | Turns the plan's graph evaluation and client-safe projection into the review panel's lines — which fields the change moves, what an approval binds to, what the browser is not sent, which configured keys have no node. A presenter only: it takes no decision and it never renders "nothing moved" and "nothing was evaluated" as the same sentence. | `apps/system-studio/src/app/tenants/[slug]/configuration/consequences.test.ts` |
| `apps/system-studio/src/app/tenants/[slug]/configuration/publication-modules.ts` | RETAIN | The one module closure the Studio hands to `planPublication`, carrying `version`. It replaced three copies in `actions.ts`, all three of which dropped the version and so made the graph digest unable to tell a republished package from an approved one. | `apps/system-studio/src/app/tenants/[slug]/configuration/consequences.test.ts` |
| `apps/system-studio/src/app/tenants/new/ComposeForm.tsx` | REFACTOR | 1,155 lines of hand-built composition questionnaire — the single largest piece of imperative form code in the repository, and the one CFG-020 exists to replace with a schema graph. Its behaviour is the specification for that graph. | `apps/system-studio/src/app/tenants/new/compose-pricing.test.tsx` |
| `apps/system-studio/src/app/tenants/new/page.tsx` | REFACTOR | Holds the coexistence-profile prose beside the form. In a declarative configurator that text is a translation key on a schema node, not a constant in a page. | `apps/system-studio/src/app/tenants/new/page.tsx` |
| `apps/system-studio/src/app/tenants/new/ChoiceGroup.tsx` | MIGRATE | Its own header says it belongs in `components/md3/` beside `Field`, `TextField`, `Select` and `Switch`. A schema-rendered configurator needs one component kit, not one plus a local copy. | `apps/system-studio/src/app/tenants/new/ChoiceGroup.tsx` |
| `apps/system-studio/src/app/tenants/new/quote.ts` | RETAIN | What the composition would cost, and what it says when it cannot say. Quoting only, in integer minor units. | `apps/system-studio/src/app/tenants/new/quote.test.tsx` |
| `apps/system-studio/src/app/tenants/new/placement.ts` | RETAIN | Where a tenant may be placed, reading the cell registry and surfacing its refusal rather than defaulting past it. | `apps/system-studio/src/app/tenants/new/placement.test.tsx` |
| `apps/system-studio/src/app/tenants/AdoptForm.tsx` | RETAIN | Adoption asks the three things the binding cannot answer instead of being a one-click button. | `apps/system-studio/src/app/tenants/AdoptForm.tsx` |
| `apps/system-studio/src/app/tenants/[slug]/AdvanceControls.tsx` | RETAIN | Renders the moves the lifecycle engine offers and shows its refusal. It decides no legality of its own, which is the property CFG-060 needs. | `apps/system-studio/src/app/tenants/[slug]/AdvanceControls.tsx` |
| `apps/system-studio/src/app/platform/audit/HoldControls.tsx` | REFACTOR | The control is right; the action behind it is not. `platform/audit/actions.ts` authorizes a production mutation with `isOperator(email)` — a membership test with no action, no resource and no scope — which is the second authorization path CFG-000-004 must remove. | `apps/system-studio/src/app/platform/audit/actions.ts` |
| `apps/system-studio/src/components/DeploymentPanel.tsx` | RETAIN | The deployment artifact a cell reconciles toward, with the facts that used to be claimed in comments and rendered nowhere. | `apps/system-studio/src/components/DeploymentPanel.tsx` |
| `apps/system-studio/src/components/EvidencePanel.tsx` | RETAIN | What a step ran against and produced, checkable against the account. CFG-060's handoff evidence renders here. | `apps/system-studio/src/components/EvidencePanel.tsx` |
| `apps/system-studio/src/components/TagCompliancePanel.tsx` | RETAIN | Where the tag contract stops being a computation and becomes something an operator has to look at. | `apps/system-studio/src/components/TagCompliancePanel.tsx` |

## The tenant application's forms — `apps/web`

These are not the configurator. They are the code the requirement means by
"existing form code": bespoke, hand-validated forms that the CFG-020 vocabulary
is supposed to make unnecessary. Three of them matched the derivation on the
component-name suffix alone and are product UX rather than configuration; saying
so is more useful than quietly filtering them out, because the next person to
read the suffix rule will otherwise wonder where they went.

| Module | Disposition | Why | Evidence |
|---|---|---|---|
| `apps/web/src/lib/forms/resource-form.ts` | MIGRATE | A second, local way of declaring a form — fields, rules, messages and order. That is precisely the namespaced UI and rule vocabulary CFG-020-001 defines once for the whole platform. | `apps/web/src/lib/forms/resource-form.test.ts` |
| `apps/web/src/components/resources/ResourceEditor.tsx` | MIGRATE | Renders that local definition by hand. It becomes a schema-rendered surface, or the vocabulary has two renderers. | `apps/web/src/components/resources/ResourceEditor.tsx` |
| `apps/web/src/components/admin/FundsFlowForm.tsx` | MIGRATE | Every responsibility axis is a select whose blank default is deliberate — a requirement rule and an approval rule in CFG-020-003's vocabulary, currently expressed in JSX. The liability gate behind it stays server-side. | `apps/web/src/app/(app)/admin/payments/liability-gate.test.ts` |
| `apps/web/src/components/finance/ReimbursementForm.tsx` | MIGRATE | The live budget guardrail is a validation rule with a derived bound; hand-written today. | `apps/web/src/components/finance/ReimbursementForm.tsx` |
| `apps/web/src/components/admin/RoleTransferPanel.tsx` | MIGRATE | A multi-step decision form with a null branch that means "the outgoing Director leaves the console". That branch is a rule, and a rule belongs in the graph where it can be tested. | `apps/web/src/components/admin/RoleTransferPanel.tsx` |
| `apps/web/src/components/admin/DirectoryPicker.tsx` | REFACTOR | A typeahead against an external directory. CFG-040 requires external checks to carry timeout, rate and error behaviour; this one keeps its job and moves onto that contract. | `apps/web/src/components/admin/DirectoryPicker.tsx` |
| `apps/web/src/lib/config/server.ts` | RETAIN | The tenant application's read side of configuration, keyed by slug because a slug is what a human writes in a binding. | `apps/web/src/lib/config/config-snapshot.test.ts` |
| `apps/web/src/app/(app)/settings/actions.ts` | REFACTOR | Profile mutations, guarded by `requireUserId` — a session check, not a decision. Bible §25 requires central action-resource-scope authorization for every command; this is one of the paths CFG-000-004 counts. | `apps/web/src/app/(app)/settings/actions.ts` |
| `apps/web/src/app/(app)/settings/page.tsx` | RETAIN | A user's own profile surface, not tenant configuration. Listed because it sits under a configuration root in the derivation. | `apps/web/src/app/(app)/settings/page.tsx` |
| `apps/web/src/components/ClubImageEditor.tsx` | RETAIN | Product UX, matched on the `Editor` suffix. Not configuration: it sets one club's image and re-checks permission server-side. | `apps/web/src/components/ClubImageEditor.tsx` |
| `apps/web/src/components/ProfileImageEditor.tsx` | RETAIN | Product UX, matched on the `Editor` suffix. A user's own picture is not tenant configuration. | `apps/web/src/components/ProfileImageEditor.tsx` |
| `apps/web/src/components/ai/TenureAIPanel.tsx` | RETAIN | Product UX, matched on the `Panel` suffix. It renders Relay answers and their citations; it configures nothing. | `apps/web/src/components/ai/TenureAIPanel.tsx` |

## Counts

| Disposition | Modules |
|---|---:|
| RETAIN | 54 |
| REFACTOR | 9 |
| MIGRATE | 6 |
| RETIRE | 0 |
| **Total** | **69** |

The counts are asserted against the table by the guard, so a row that changes
disposition without the summary changing reds.
