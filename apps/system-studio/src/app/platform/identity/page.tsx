import { Fragment } from "react"

import {
  Badge,
  Card,
  Chip,
  DataTable,
  EmptyState,
  KeyValue,
  SeverityChip,
  StaleIndicator,
  Surface,
  UnknownState,
  type DataColumn,
  type KeyValueItem,
} from "@/components/md3"
import { auth } from "@/lib/auth"
import { analyzerReadings } from "@/lib/aws/analyzer"
import {
  cognitoReadings,
  describeMfaPosture,
  describePasswordPolicy,
  type OperatorReading,
} from "@/lib/aws/cognito"
import { iamPosture, type IamAccessKey, type IamWildcard } from "@/lib/aws/iam"
import {
  describeKeyAttribution,
  describeLifecycle,
  describeRotation,
  keyReadings,
  type KeyReading,
} from "@/lib/aws/keys"
import { identityHeadline } from "@/lib/aws/identity"
import {
  describeSecretAttribution,
  secretReadings,
  type OverdueSecret,
  type UnrotatedSecret,
} from "@/lib/aws/secrets"
import { isOperator, operatorConfigProblems } from "@/lib/operators"

import {
  administratorCount,
  allGuards,
  consolePool,
  describeConsolePoolGap,
  DOOR_WORDS,
  GUARD_TONE,
  GUARD_WORDS,
  identityVerdict,
  keysNotRotating,
  mfaEnrolmentSentence,
  notPassing,
  operatorDoor,
  passing,
  rankKeys,
  rankWildcards,
  statusWord,
  unknownArm,
  WILDCARD_SEVERITY,
  wildcardKey,
  type GuardRow,
} from "./doors"
import styles from "./identity.module.css"

export const dynamic = "force-dynamic"

/**
 * STUDIO — identity: who can get into this control plane and into this account,
 * and what is protecting those doors.
 *
 * ── The question, and why the shape of the page follows from it ────────────
 *
 * That sentence is at the top of the page in words before any apparatus,
 * because it is the only reason an operator opens this route. The lead is a
 * COUNT — how many principals can administer this platform — because the first
 * thing anybody wants from a page called Identity is the size of the set, and
 * the count is the one number that spans both doors.
 *
 * ── The rule this page is built around ─────────────────────────────────────
 *
 * **An absence of findings from a control that is not running is NOT a pass.**
 *
 * An account with no IAM Access Analyzer has no external-access findings; a
 * wildcard sweep that could not read `AdministratorAccess` reports no wildcard
 * on the one principal that holds every one; a rotation posture over a truncated
 * key listing reports no key with rotation off. Through a naive page each of
 * those renders as a clean estate.
 *
 * So the guards that are NOT protection get their own card, ABOVE the findings,
 * with `GUARD_WORDS` printing the reason as a WORD rather than as a colour —
 * "Not running — nothing is checking" reads nothing like "Checked and clean",
 * which is the entire point. `identityVerdict` in `./doors.ts` cannot reach its
 * clear arm while one guard sits in any other arm, and `doors.test.ts` mutates
 * that branch to prove it.
 *
 * ── The 2026-08-13 audit ───────────────────────────────────────────────────
 *
 * An audit found that the migration had reissued a shared secret as a PERMANENT
 * password with the pool's MFA set to OPTIONAL, and that nothing in this console
 * could see either fact. Both are on this page now, as findings rather than as
 * footnotes: the console pool's card leads with its MFA posture and its
 * password policy, and the operator table carries, per account, the status, the
 * MFA enrolment this engine can and cannot read, the temporary-password window,
 * and the reader's `neverForcedAPasswordChange` suspicion with the caveat that
 * would disprove it.
 *
 * ── What it does not print ─────────────────────────────────────────────────
 *
 * No password, no token, no client secret, no raw user attribute beyond the
 * sign-in identifier. `lib/aws/cognito.ts` narrows the roster read to `email`
 * and carries exactly one identifier per account out of the module, so there is
 * no attribute here to leak; the app-client reading carries `hasSecret` as a
 * BOOLEAN and never the secret itself. Access key IDs ARE printed, because
 * `aws iam update-access-key --access-key-id …` takes one and a masked id is an
 * unactionable finding — an id is not a credential.
 *
 * ── It renders without AWS ─────────────────────────────────────────────────
 *
 * Nothing here throws when STS, Cognito, IAM, Access Analyzer, KMS and Secrets
 * Manager are all unreachable. Every refusal is an arm of `AwsRead`, every arm
 * renders through the shared `UnknownState` carrying the principal, the action
 * and a pasteable minimum statement, and no table is drawn from a read that did
 * not answer. A console that 500s for want of credentials is not a refusal
 * anyone can act on.
 */
export default async function IdentityPage() {
  if (operatorConfigProblems().length > 0) {
    return (
      <div className="misconfigured">
        <h1>Not configured</h1>
        <p>The Studio refuses to serve until its access control is set up.</p>
      </div>
    )
  }

  const session = await auth()
  if (!isOperator(session?.user?.email)) {
    const { redirect } = await import("next/navigation")
    redirect("/signin")
  }

  /*
   * Five readers, sequentially.
   *
   * Not `Promise.all`: each of these walks pages of its own and every one of
   * them shares the throttle budget in `lib/aws/throttle.ts`. Firing five page
   * walks at once is how a read that would have answered comes back THROTTLED,
   * and a THROTTLED panel on a page about who can administer the platform is a
   * question left unanswered for the sake of a second.
   */
  const cognito = await cognitoReadings()
  const iam = await iamPosture()
  const analyzer = await analyzerReadings()
  const kms = await keyReadings()
  const secrets = await secretReadings()

  const identity = cognito.identity
  const known = identity.state === "ACTUAL" || identity.state === "STALE" ? identity.value : null

  const admins = administratorCount(cognito, iam)
  const guards = allGuards({ cognito, iam, analyzer, keys: kms, secrets })
  const gaps = notPassing(guards)
  const guarding = passing(guards)
  const verdict = identityVerdict({ admins, guards })

  const pool = consolePool(cognito)
  const poolDetail =
    pool && (pool.detail.state === "ACTUAL" || pool.detail.state === "STALE")
      ? pool.detail.value
      : null
  const operators =
    pool && (pool.operators.state === "ACTUAL" || pool.operators.state === "STALE")
      ? pool.operators.value.operators
      : []

  const wildcards = rankWildcards(iam.posture?.wildcards ?? [])
  const accessKeys = rankKeys(iam.posture?.accessKeys ?? [])
  const unrotatedKeys = keysNotRotating(kms)
  const unrotatedSecrets =
    secrets.posture.kind === "assessed" ? secrets.posture.noRotation : []
  const overdueSecrets = secrets.posture.kind === "assessed" ? secrets.posture.overdue : []

  const cognitoUnknown = unknownArm(cognito.pools)
  const iamUnknown = unknownArm(iam.read)
  const analyzerUnknown = unknownArm(analyzer.analyzers)
  const kmsUnknown = unknownArm(kms.keys)
  const secretsUnknown = unknownArm(secrets.secrets)
  const rosterUnknown = pool ? unknownArm(pool.operators) : null
  const poolDetailUnknown = pool ? unknownArm(pool.detail) : null

  /* ── the tables, as data ─────────────────────────────────────────────── */

  /**
   * A guard, and why it is or is not protection.
   *
   * The state column carries the WORD as well as the tone: "Not running" and
   * "Checked and clean" produce the same empty findings list, and colour alone
   * cannot be what tells an operator which of the two they are looking at.
   */
  const guardColumns: readonly DataColumn<GuardRow>[] = [
    {
      key: "control",
      header: "Guard",
      cell: (row) => (
        <div className={styles.cell}>
          <span>{row.control}</span>
          <span className="md3-body-small">{DOOR_WORDS[row.door]}</span>
        </div>
      ),
    },
    {
      key: "state",
      header: "State",
      cell: (row) => (
        <div className={styles.cell}>
          <Badge tone={GUARD_TONE[row.state]}>{GUARD_WORDS[row.state]}</Badge>
          <span className="md3-body-small">
            {row.findings === null
              ? "no count — this guard did not run"
              : `${row.findings} finding(s)`}
          </span>
        </div>
      ),
    },
    {
      key: "question",
      header: "What it answers",
      cell: (row) => <div className={styles.cell}>{row.question}</div>,
    },
    {
      key: "detail",
      header: "Why it is in that state",
      cell: (row) => <div className={styles.cell}>{row.detail}</div>,
    },
    {
      key: "remedy",
      header: "Remedy",
      cell: (row) => <div className={styles.cell}>{row.remedy}</div>,
    },
  ]

  /**
   * One operator account.
   *
   * The sign-in identifier and nothing else identifies the person: no phone
   * number, no name, no attribute the roster happened to return. The two columns
   * that matter to the 2026-08-13 audit are the last two — the second factor
   * this engine can and cannot see, and whether the account looks like it is
   * still holding a password an administrator set.
   */
  const operatorColumns: readonly DataColumn<OperatorReading>[] = [
    {
      key: "identifier",
      header: "Sign-in identifier",
      cell: (operator) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{operator.signInIdentifier}</span>
          <span className="md3-body-small">from the {operator.identifierProvenance}</span>
        </div>
      ),
    },
    {
      key: "door",
      header: "Can it sign in?",
      cell: (operator) => {
        const door = operatorDoor(operator)
        return (
          <div className={styles.cell}>
            <Badge
              tone={door.kind === "open" ? "warn" : door.kind === "closed" ? "neutral" : "warn"}
            >
              {door.kind === "open" ? "Yes" : door.kind === "closed" ? "No" : "Not established"}
            </Badge>
            <span className="md3-body-small">{door.why}</span>
          </div>
        )
      },
    },
    {
      key: "status",
      header: "Status",
      cell: (operator) => (
        <div className={styles.cell}>
          <span>{statusWord(operator.status)}</span>
          <span className="md3-body-small">
            {operator.enabled === null
              ? "the roster returned no Enabled flag for this account"
              : operator.enabled
                ? "enabled in the pool"
                : "disabled in the pool"}
          </span>
        </div>
      ),
    },
    {
      key: "mfa",
      header: "Second factor",
      cell: (operator) => (
        <div className={styles.cell}>
          <Badge tone={operator.mfa.smsConfigured ? "info" : "warn"}>
            {operator.mfa.smsConfigured ? "SMS enrolled" : "No SMS factor"}
          </Badge>
          <span className="md3-body-small">{mfaEnrolmentSentence(operator)}</span>
        </div>
      ),
    },
    {
      key: "first-sign-in",
      header: "First sign-in window",
      cell: (operator) => {
        const window = operator.firstSignInWindow
        switch (window.kind) {
          case "not-pending":
            return <div className={styles.cell}>{window.why}</div>
          case "open":
            return (
              <div className={styles.cell}>
                <Badge tone="warn">Open</Badge>
                <span className="md3-body-small">
                  {window.ageDays} of {window.windowDays} day(s) elapsed since {window.since} —{" "}
                  {window.sinceMeans}
                </span>
              </div>
            )
          case "expired":
            return (
              <div className={styles.cell}>
                <Badge tone="bad">Expired</Badge>
                <span className="md3-body-small">
                  {window.ageDays} day(s) since {window.since}, past a {window.windowDays}-day
                  window — {window.why}
                </span>
              </div>
            )
          case "unknown":
            return (
              <div className={styles.cell}>
                <Badge tone="warn">Not established</Badge>
                <span className="md3-body-small">{window.why}</span>
              </div>
            )
        }
      },
    },
    {
      key: "permanent-password",
      header: "Administrator-set password",
      cell: (operator) => {
        const suspicion = operator.neverForcedAPasswordChange
        if (suspicion === null) {
          return (
            <div className={styles.cell}>
              not suspected — this account either completed a forced password change or the
              question could not be asked of it
            </div>
          )
        }
        return (
          <div className={styles.cell}>
            <SeverityChip severity="critical">suspected</SeverityChip>
            <span className="md3-body-small">{suspicion.why}</span>
            <span className="md3-body-small">{suspicion.caveat}</span>
          </div>
        )
      },
    },
  ]

  /** One wildcard grant, worst kind first. */
  const wildcardColumns: readonly DataColumn<IamWildcard>[] = [
    {
      key: "kind",
      header: "Kind",
      cell: (wildcard) => (
        <div className={styles.cell}>
          <SeverityChip severity={WILDCARD_SEVERITY[wildcard.kind]}>{wildcard.kind}</SeverityChip>
          {wildcard.conditioned ? (
            <span className="md3-body-small">
              a Condition narrows it — narrowed is not removed
            </span>
          ) : (
            <span className="md3-body-small">no Condition on the statement</span>
          )}
        </div>
      ),
    },
    {
      key: "principal",
      header: "Principal",
      cell: (wildcard) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{wildcard.principalArn}</span>
          <span className="md3-body-small">
            {wildcard.source} · {wildcard.policyName}
            {wildcard.statementSid ? ` · sid ${wildcard.statementSid}` : ""}
          </span>
        </div>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (wildcard) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{wildcard.actions.join(", ") || "none listed"}</span>
          <span className="md3-body-small">{wildcard.actionScope}</span>
        </div>
      ),
    },
    {
      key: "resources",
      header: "Resources",
      cell: (wildcard) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>
            {wildcard.resources.join(", ") || "none listed"}
          </span>
          <span className="md3-body-small">{wildcard.resourceScope}</span>
        </div>
      ),
    },
    {
      key: "detail",
      header: "What it grants",
      cell: (wildcard) => <div className={styles.cell}>{wildcard.detail}</div>,
    },
  ]

  /** One access key, oldest first. Age is the whole finding. */
  const keyColumns: readonly DataColumn<IamAccessKey>[] = [
    {
      key: "id",
      header: "Access key",
      cell: (key) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{key.accessKeyId}</span>
          <span className="md3-body-small">user {key.userName}</span>
        </div>
      ),
    },
    {
      key: "age",
      header: "Age",
      align: "end",
      cell: (key) => (
        <div className={styles.cell}>
          <span>{key.ageDays === null ? "not dated" : `${key.ageDays} day(s)`}</span>
          <span className="md3-body-small">
            {key.createdAt ?? "iam:ListAccessKeys returned no creation date for this key"}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (key) => (
        <div className={styles.cell}>
          <Badge tone={key.longLived ? "bad" : key.status === "Active" ? "info" : "neutral"}>
            {key.longLived ? "Long-lived" : key.status}
          </Badge>
          <span className="md3-body-small">{key.detail}</span>
        </div>
      ),
    },
  ]

  /** One customer-managed key whose automatic rotation is off. */
  const kmsColumns: readonly DataColumn<KeyReading>[] = [
    {
      key: "key",
      header: "Key",
      cell: (key) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{key.arn ?? key.keyId}</span>
          <span className="md3-body-small">{key.arnProvenance}</span>
        </div>
      ),
    },
    {
      key: "rotation",
      header: "Rotation",
      cell: (key) => (
        <div className={styles.cell}>
          <Badge tone="bad">Disabled</Badge>
          <span className="md3-body-small">{describeRotation(key.rotation)}</span>
        </div>
      ),
    },
    {
      key: "lifecycle",
      header: "Lifecycle",
      cell: (key) => <div className={styles.cell}>{describeLifecycle(key.lifecycle)}</div>,
    },
    {
      key: "attribution",
      header: "Belongs to",
      cell: (key) => <div className={styles.cell}>{describeKeyAttribution(key.attribution)}</div>,
    },
  ]

  /** One secret with no rotation configured at all. */
  const unrotatedColumns: readonly DataColumn<UnrotatedSecret>[] = [
    {
      key: "name",
      header: "Secret",
      cell: (secret) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{secret.name}</span>
          <span className="md3-body-small">{secret.arn ?? "no ARN was returned for it"}</span>
        </div>
      ),
    },
    {
      key: "age",
      header: "Unchanged for",
      align: "end",
      cell: (secret) => (
        <div className={styles.cell}>
          <span>
            {secret.ageSinceChangeMs === null
              ? "not dated"
              : `${Math.round(secret.ageSinceChangeMs / 86_400_000)} day(s)`}
          </span>
          <span className="md3-body-small">
            {secret.lastChangedAt ?? "the listing returned no last-changed date"}
          </span>
        </div>
      ),
    },
    {
      key: "attribution",
      header: "Belongs to",
      cell: (secret) => (
        <div className={styles.cell}>{describeSecretAttribution(secret.attribution)}</div>
      ),
    },
  ]

  /** One secret past the interval somebody configured for it. */
  const overdueColumns: readonly DataColumn<OverdueSecret>[] = [
    {
      key: "name",
      header: "Secret",
      cell: (secret) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{secret.name}</span>
          <span className="md3-body-small">{secret.arn ?? "no ARN was returned for it"}</span>
        </div>
      ),
    },
    {
      key: "overdue",
      header: "Overdue by",
      align: "end",
      cell: (secret) => (
        <div className={styles.cell}>
          <span>{Math.round(secret.overdueByMs / 86_400_000)} day(s)</span>
          <span className="md3-body-small">due {secret.dueAt}</span>
        </div>
      ),
    },
    {
      key: "basis",
      header: "On what basis",
      cell: (secret) => (
        <div className={styles.cell}>
          <span>{secret.basis}</span>
          <span className="md3-body-small">
            {secret.lastRotatedAt
              ? `last rotated ${secret.lastRotatedAt}`
              : "it has never rotated"}
          </span>
        </div>
      ),
    },
    {
      key: "attribution",
      header: "Belongs to",
      cell: (secret) => (
        <div className={styles.cell}>{describeSecretAttribution(secret.attribution)}</div>
      ),
    },
  ]

  /* ── the console pool's own facts ────────────────────────────────────── */

  const poolFacts: readonly KeyValueItem[] = pool
    ? [
        {
          key: "pool",
          term: "Pool",
          value: <code className={styles.identifier}>{pool.arn ?? pool.poolId}</code>,
        },
        { key: "arn-provenance", term: "How that ARN was arrived at", value: pool.arnProvenance },
        {
          key: "mfa",
          term: "Multi-factor authentication",
          value: describeMfaPosture(pool.mfaPosture),
          asOf: { at: pool.asOf, cadenceMs: cognito.refreshMs.mfa },
        },
        {
          key: "policy",
          term: "Password policy",
          value: poolDetail
            ? describePasswordPolicy(poolDetail)
            : "unread — cognito-idp:DescribeUserPool did not answer for this pool, which is not a report that it has no policy",
          asOf: { at: pool.asOf, cadenceMs: cognito.refreshMs.detail },
        },
        {
          key: "self-signup",
          term: "Self sign-up",
          value:
            poolDetail === null
              ? "unread"
              : poolDetail.adminCreateUserOnly === null
                ? "the describe returned no AdminCreateUserConfig, so whether anybody can sign themselves up is unread"
                : poolDetail.adminCreateUserOnly
                  ? "closed — only an administrator can create an account in this pool"
                  : "OPEN — anybody who can reach the hosted sign-up page can create an account in the pool that gates this console",
        },
        {
          key: "location",
          term: "Where it is",
          value: pool.locationProvenance,
        },
      ]
    : []

  return (
    <div className={styles.page}>
      <header className={styles.lead}>
        <h1 className="md3-headline-large">Identity</h1>
        {/*
          The question, in words, before any apparatus. It is the whole reason
          this route exists and every card below is arranged to answer it.
        */}
        <p className="md3-title-medium">
          Who can get into this control plane and into this account, and what is protecting those
          doors?
        </p>
        <p className="md3-body-large">{verdict.headline}</p>
        {/*
          Which estate this is, before anything is claimed about it. Three chips
          when the identity read answered; one sentence when it did not, because
          three sentences in three pills is how a 320px viewport draws one over
          the next.
        */}
        {known ? (
          <div className={styles.row}>
            <Chip>
              <span>account</span>
              <span className={styles.identifier}>{known.accountId}</span>
            </Chip>
            <Chip>
              <span>region</span>
              <span className={styles.identifier}>{known.region}</span>
            </Chip>
            <Chip>
              <span>partition</span>
              <span className={styles.identifier}>{known.partition}</span>
            </Chip>
          </div>
        ) : (
          <p className="md3-body-medium">{identityHeadline(identity)}</p>
        )}
      </header>

      {/* 1 — the answer: the count, and what qualifies it. */}
      <Card
        headline="How many principals can administer this platform"
        headerAside={<Badge tone={verdict.tone}>{verdict.verdict}</Badge>}
        supportingText={
          <>
            Read live on every load, from Cognito, IAM, Access Analyzer, KMS and Secrets Manager.
            As of{" "}
            <StaleIndicator
              asOf={cognito.asOf}
              cadenceMs={cognito.refreshMs.operators}
              label="this identity reading"
            />
          </>
        }
      >
        <div className={styles.stack}>
          <p className="md3-body-medium">{verdict.because}</p>

          {admins.kind === "counted" ? (
            <div className={styles.row}>
              <Chip>
                <span>{DOOR_WORDS["control-plane"]}</span>
                <span>{admins.consoleOperators} operator account(s)</span>
              </Chip>
              <Chip>
                <span>{DOOR_WORDS.account}</span>
                <span>{admins.accountAdministrators} administering principal(s)</span>
              </Chip>
            </div>
          ) : (
            /*
              Deliberately not a chip row of numbers. A count this engine cannot
              stand behind, rendered as two tidy pills, is read as a total — and
              the sentence in the header already says it is a floor or unknown.
              The reasons are here, in full, because they are the answer.
            */
            <details className={styles.disclosure}>
              <summary className="md3-label-large">
                Why that number is {admins.kind === "floor" ? "a floor" : "unknown"} —{" "}
                {admins.qualifiers.length} reason(s)
              </summary>
              <ul className={styles.reasons}>
                {admins.qualifiers.map((qualifier) => (
                  <li key={qualifier} className="md3-body-medium">
                    {qualifier}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/*
            The governed state of each read, through the shared primitive.
            Rendered nowhere at all when a read succeeded; on a denial each
            carries the principal, the action, the error code and the minimum IAM
            statement — which is why they sit with the answer rather than at the
            foot of the page: when the answer is "unknown", the fix is the rest
            of the answer.
          */}
          {cognitoUnknown ? (
            <UnknownState what="the Cognito user pools in this region" read={cognitoUnknown} />
          ) : null}
          {iamUnknown ? (
            <UnknownState what="this account's IAM roles, policies and access keys" read={iamUnknown} />
          ) : null}
          {analyzerUnknown ? (
            <UnknownState what="the IAM Access Analyzer listing" read={analyzerUnknown} />
          ) : null}
          {kmsUnknown ? <UnknownState what="this account's KMS keys" read={kmsUnknown} /> : null}
          {secretsUnknown ? (
            <UnknownState what="this account's Secrets Manager secrets" read={secretsUnknown} />
          ) : null}
        </div>
      </Card>

      {/* 2 — what is NOT protecting these doors. Above the findings, deliberately. */}
      <Card
        headline="Not protection"
        headerAside={
          <Badge tone={gaps.length === 0 ? "ok" : "bad"}>
            {gaps.length} of {guards.length}
          </Badge>
        }
        supportingText="Worst first: guards that found something, then guards this engine could not read, then guards that are not running at all, then guards that covered only part of what they claim. An absence of findings from a control that is not running is not a pass, and every row here is one"
      >
        <DataTable
          caption={`Guards that are not protection — as of ${cognito.asOf}`}
          columns={guardColumns}
          rows={gaps}
          rowKey={(row) => row.key}
          empty={
            <EmptyState
              headline="Every guard on both doors is protection"
              description="All of the guards this page knows about ran, over everything each of them claims to cover, and found nothing. That is the only condition under which an empty list on this page means these doors are guarded."
            />
          }
        />
      </Card>

      {/* 3 — the front door: the pool that gates this console. */}
      <Card
        headline="The pool that gates this console"
        headerAside={
          <Badge tone={pool ? "info" : "warn"}>
            {pool ? pool.poolId : "not identified"}
          </Badge>
        }
        supportingText="Identified by the tenure:module tag and never by name — a pool called after this console is a string somebody typed, and picking a front door by name is how a console describes the wrong pool's MFA setting with total confidence"
      >
        <div className={styles.stack}>
          <p className="md3-body-medium">{describeConsolePoolGap(cognito)}</p>

          {pool ? <KeyValue items={poolFacts} ariaLabel="Facts about the console's user pool" /> : null}

          {poolDetailUnknown ? (
            <UnknownState
              what="the console pool's password policy and sign-up configuration"
              read={poolDetailUnknown}
            />
          ) : null}
          {rosterUnknown ? (
            <UnknownState what="the console pool's operator roster" read={rosterUnknown} />
          ) : null}

          {pool && pool.operators.state !== "DENIED" && pool.operators.state !== "THROTTLED" &&
          pool.operators.state !== "UNCONFIGURED" && pool.operators.state !== "ERROR" ? (
            <DataTable
              caption={`Operator accounts in ${pool.poolId} — as of ${pool.asOf}`}
              columns={operatorColumns}
              rows={operators}
              rowKey={(operator) => operator.signInIdentifier}
              empty={
                <EmptyState
                  headline="No account in the pool that gates this console"
                  description="cognito-idp:ListUsers answered and returned nothing. A console nobody can sign into is not a secure console — it is a pool that is not the one gating this console, or a tag on the wrong pool."
                />
              }
            />
          ) : null}
        </div>
      </Card>

      {/* 4 — the account door: IAM. */}
      <Card
        headline="IAM — wildcard grants and long-lived keys"
        headerAside={
          /*
           * `!== null` rather than a truthiness test, so the ONE remaining
           * `{iam.posture ? (` in this file is the guard on the tables below.
           * `identity-surface.spec.ts` anchors on it to prove those tables cannot
           * be drawn from a read that did not answer, and an anchor that matches
           * two sites is an anchor that proves the wrong one — which a mutation
           * of the real guard survived until this line was changed.
           *
           * A block comment and not a `{/* … *\/}` JSX comment: this is a PROP
           * expression container, which is JavaScript and not JSX children, so a
           * JSX comment here opens an object literal and reds the build.
           */
          <Badge tone={iam.posture !== null ? (wildcards.length === 0 ? "ok" : "bad") : "warn"}>
            {iam.posture !== null ? `${wildcards.length} wildcard(s)` : "not read"}
          </Badge>
        }
        supportingText={`${iam.headline} — ${iam.scope.detail}`}
      >
        <div className={styles.stack}>
          {iam.posture ? (
            <>
              <DataTable
                caption={`Wildcard actions and resources — as of ${iam.asOf}`}
                columns={wildcardColumns}
                rows={wildcards}
                rowKey={wildcardKey}
                empty={
                  <EmptyState
                    headline="No wildcard in the policies this sweep could read"
                    description={iam.posture.sweepCoverage.detail}
                  />
                }
              />
              <DataTable
                caption={`Access keys, oldest first — as of ${iam.asOf}`}
                columns={keyColumns}
                rows={accessKeys}
                rowKey={(key) => `${key.userName}::${key.accessKeyId}`}
                empty={
                  <EmptyState
                    headline="No access key on any user that answered"
                    description={iam.posture.keyCoverage.detail}
                  />
                }
              />
              <details className={styles.disclosure}>
                <summary className="md3-label-large">
                  Policies this sweep did NOT read — {iam.posture.unswept.length} unswept,{" "}
                  {iam.posture.unreadableDocuments.length} that did not parse
                </summary>
                <ul className={styles.reasons}>
                  {[...iam.posture.unswept, ...iam.posture.unreadableDocuments].map((policy) => (
                    <li
                      key={`${policy.principalArn}::${policy.policyName}`}
                      className="md3-body-medium"
                    >
                      <span className={styles.identifier}>
                        {policy.principalName} · {policy.policyName}
                      </span>{" "}
                      — {policy.why}
                    </li>
                  ))}
                  {iam.posture.unswept.length === 0 &&
                  iam.posture.unreadableDocuments.length === 0 ? (
                    <li className="md3-body-medium">
                      Every policy document attached to every principal was returned and parsed.
                    </li>
                  ) : null}
                </ul>
              </details>
            </>
          ) : (
            /*
              Deliberately not an empty table. An empty table under a heading
              naming wildcard grants is read as "there are none", which is the
              one thing this page must never say about an account it could not
              look at.
            */
            <p className="md3-body-medium">
              No table is drawn. The IAM read did not answer, so this console knows of no wildcard
              grant and of no absence of one; the panel in the card above names what would have to
              be granted for that to change.
            </p>
          )}
        </div>
      </Card>

      {/* 5 — external access, and the absence of the check. */}
      <Card
        headline="Access outside this account"
        headerAside={
          <Badge
            tone={
              analyzer.externalAccess.kind === "external-access"
                ? "bad"
                : analyzer.externalAccess.kind === "none-found"
                  ? "ok"
                  : "warn"
            }
          >
            {analyzer.externalAccess.kind === "external-access"
              ? `${analyzer.externalAccess.totalActive} finding(s)`
              : analyzer.externalAccess.kind === "none-found"
                ? "none found"
                : "not checked"}
          </Badge>
        }
        supportingText="IAM Access Analyzer evaluates whether this estate's buckets, keys, roles, queues, secrets and repositories grant access to a principal outside the account. Where NO analyzer exists, that is the finding — it is the absence of the check, never the absence of the exposure"
      >
        <div className={styles.stack}>
          <p className="md3-body-medium">
            {analyzer.externalAccess.kind === "external-access"
              ? `${analyzer.externalAccess.totalActive} active external-access finding(s).`
              : analyzer.externalAccess.kind === "none-found"
                ? `${analyzer.externalAccess.analyzersRead.length} analyzer(s) answered and reported no active external-access finding.`
                : analyzer.externalAccess.why}
          </p>
          {analyzer.externalAccess.kind !== "external-access" &&
          analyzer.externalAccess.kind !== "none-found" ? (
            <Surface as="section" container="lowest" level={0} shape="medium" outlined role="status">
              <p className="md3-label-small">Remedy</p>
              <p className="md3-body-medium">{analyzer.externalAccess.remedy}</p>
            </Surface>
          ) : null}

          {analyzer.externalAccess.kind === "external-access" ? (
            <DataTable
              caption={`Resources granting access outside this account — as of ${analyzer.asOf}`}
              columns={[
                {
                  key: "resource",
                  header: "Resource",
                  cell: (exposure) => (
                    <div className={styles.cell}>
                      <span className={styles.identifier}>
                        {exposure.resource ?? "AWS returned no resource ARN on this finding"}
                      </span>
                      <span className="md3-body-small">{exposure.resourceType}</span>
                    </div>
                  ),
                },
                {
                  key: "status",
                  header: "Status",
                  cell: (exposure) => (
                    <div className={styles.cell}>
                      <span>{exposure.status}</span>
                      <span className="md3-body-small">{exposure.findingType}</span>
                    </div>
                  ),
                },
                {
                  key: "principal",
                  header: "External principal",
                  cell: (exposure) => (
                    <div className={styles.cell}>{exposure.externalPrincipal.why}</div>
                  ),
                },
                {
                  key: "analyzed",
                  header: "Analyzed",
                  cell: (exposure) => (
                    <div className={styles.cell}>
                      <span className={styles.identifier}>
                        {exposure.analyzedAt ?? "no analysis time was returned"}
                      </span>
                      <span className="md3-body-small">
                        by {exposure.analyzerArn}
                      </span>
                    </div>
                  ),
                },
              ]}
              rows={analyzer.externalAccess.exposures}
              rowKey={(exposure) => exposure.findingId}
              empty={
                <EmptyState
                  headline="No exposure carried in this reading"
                  description="The verdict above says an external-access finding exists, and no row came with it. That is a defect in this page, not a clean account."
                />
              }
            />
          ) : null}
        </div>
      </Card>

      {/* 6 — the keys and secrets protecting everything else. */}
      <Card
        headline="Keys and secrets"
        headerAside={
          <Badge tone={unrotatedKeys.length + unrotatedSecrets.length + overdueSecrets.length === 0 ? "ok" : "bad"}>
            {unrotatedKeys.length + unrotatedSecrets.length + overdueSecrets.length} not rotating
          </Badge>
        }
        supportingText="Customer-managed KMS keys with automatic rotation disabled, then secrets with no rotation configured, then secrets past the interval somebody configured for them. AWS-managed keys are excluded from every count here and are not a pass — AWS rotates them on its own schedule and no customer setting exists"
      >
        <div className={styles.stack}>
          <DataTable
            caption={`Customer-managed keys with rotation disabled — as of ${kms.asOf}`}
            columns={kmsColumns}
            rows={unrotatedKeys}
            rowKey={(key) => key.keyId}
            empty={
              <EmptyState
                headline="No customer-managed key with rotation disabled in this reading"
                description={`${kms.posture.customerManagedRead} customer-managed key(s) had their rotation status read, ${kms.posture.rotationUnknown.length} did not, ${kms.posture.unreadable.length} could not be described, and ${kms.posture.awsManagedExcluded} AWS-managed key(s) were excluded. Read that against the guard card above before treating this as clean.`}
              />
            }
          />
          <DataTable
            caption={`Secrets with no rotation configured — as of ${secrets.asOf}`}
            columns={unrotatedColumns}
            rows={unrotatedSecrets}
            rowKey={(secret) => secret.arn ?? secret.name}
            empty={
              <EmptyState
                headline="No secret without rotation in this reading"
                description={
                  secrets.posture.kind === "assessed"
                    ? `${secrets.posture.secretsAssessed} secret(s) were assessed and ${secrets.posture.undetermined.length} could not be decided.`
                    : secrets.posture.why
                }
              />
            }
          />
          <DataTable
            caption={`Secrets past their rotation interval — as of ${secrets.asOf}`}
            columns={overdueColumns}
            rows={overdueSecrets}
            rowKey={(secret) => secret.arn ?? secret.name}
            empty={
              <EmptyState
                headline="No overdue secret in this reading"
                description="A secret is overdue only against an interval somebody configured. A cron schedule is a schedule and not a period, and this console will not guess one — those secrets are reported as undetermined rather than as on time."
              />
            }
          />
        </div>
      </Card>

      {/* 7 — what IS protection, so the list above can be read against it. */}
      <Card
        headline="Protection"
        headerAside={
          <Badge tone={guarding.length === 0 ? "bad" : "ok"}>
            {guarding.length} of {guards.length}
          </Badge>
        }
        supportingText="Guards that ran, over everything each of them claims to cover, and found nothing. A finding this list cannot produce cannot appear on this page at all"
      >
        <DataTable
          caption={`Guards that are protection — as of ${cognito.asOf}`}
          columns={guardColumns}
          rows={guarding}
          rowKey={(row) => row.key}
          empty={
            <EmptyState
              headline="Nothing on either door is protection"
              description="Not one guard on this page ran to completion over this estate and came back clean. Every empty list on this surface is therefore an absence of checking rather than an absence of findings, and the card above names each one and what it would take to change that."
            />
          }
        />
      </Card>

      {/* 8 — the provenance. */}
      <Card
        headline="Where this reading came from"
        supportingText="Every value on this page is from a call it made, or is named as unknown"
      >
        <div className={styles.stack}>
          <dl className={styles.facts}>
            <Fragment key="identity">
              <dt>Identity</dt>
              <dd className={styles.identifier}>{identityHeadline(identity)}</dd>
            </Fragment>
            <Fragment key="cognito">
              <dt>Cognito</dt>
              <dd className={styles.identifier}>
                cognito-idp:ListUserPools, then DescribeUserPool, GetUserPoolMfaConfig,
                ListUserPoolClients and ListUsers per pool — answered {cognito.pools.state}, as of{" "}
                {cognito.asOf}
              </dd>
            </Fragment>
            <Fragment key="iam">
              <dt>IAM</dt>
              <dd className={styles.identifier}>
                iam:GetAccountAuthorizationDetails, then iam:ListAccessKeys per user — answered{" "}
                {iam.read.state}, as of {iam.asOf}
              </dd>
            </Fragment>
            <Fragment key="analyzer">
              <dt>Access Analyzer</dt>
              <dd className={styles.identifier}>
                access-analyzer:ListAnalyzers, then ListFindingsV2 per analyzer — answered{" "}
                {analyzer.analyzers.state}, as of {analyzer.asOf}
              </dd>
            </Fragment>
            <Fragment key="kms">
              <dt>KMS</dt>
              <dd className={styles.identifier}>
                kms:ListKeys, then DescribeKey and GetKeyRotationStatus per key — answered{" "}
                {kms.keys.state}, as of {kms.asOf}
              </dd>
            </Fragment>
            <Fragment key="secrets">
              <dt>Secrets Manager</dt>
              <dd className={styles.identifier}>
                secretsmanager:ListSecrets, then DescribeSecret per secret — answered{" "}
                {secrets.secrets.state}, as of {secrets.asOf}
              </dd>
            </Fragment>
          </dl>

          <details className={styles.disclosure}>
            <summary className="md3-label-large">What this page deliberately does not read</summary>
            <ul className={styles.reasons}>
              <li className="md3-body-medium">
                No password, token, client secret or user attribute beyond the sign-in identifier.
                The roster read is narrowed to the email attribute at the client and narrowed again
                in the reader, so there is nothing else here to print.
              </li>
              <li className="md3-body-medium">
                Software-token (TOTP) enrolment per account. It lives in UserMFASettingList, which
                only cognito-idp:AdminGetUser returns, and that capability is deliberately not held.
                Every operator row says so rather than rendering a blank cell that reads as "no MFA".
              </li>
              <li className="md3-body-medium">
                When an operator last signed in. Cognito's roster read returns no authentication
                timestamp in any SDK version; last-modified is not last sign-in and is not shown as
                though it were.
              </li>
              <li className="md3-body-medium">
                The external principal on an Access Analyzer finding. It is a field of
                GetFindingV2, not of the listing this engine reads.
              </li>
              <li className="md3-body-medium">
                Nothing on this page writes, changes, disables or rotates anything. Every module it
                reads through is read-only; a finding here is made visible so a human can act on it.
              </li>
            </ul>
          </details>
        </div>
      </Card>
    </div>
  )
}
