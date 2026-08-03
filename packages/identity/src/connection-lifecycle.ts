/**
 * GE-043-001 — a federation connection moves through states, not settings.
 *
 * Bible §"Wave 2": "Enterprise SAML/OIDC/SCIM connection lifecycle."
 *
 * The failure this exists to prevent is specific and common. Somebody pastes an
 * identity provider's metadata into a form, saves, and the tenant's entire
 * staff cannot sign in — because the certificate was for the wrong environment,
 * or the entity id had a trailing slash, or the clock on the IdP was an hour
 * out. The people who could fix it are the people locked out.
 *
 * So a connection cannot go straight from typed to live. `ACTIVE` is reachable
 * only from `TESTED`, and `TESTED` only from a test that actually succeeded,
 * against the exact configuration being activated. That last clause is the one
 * that matters: a test proving an *older* configuration works is not evidence
 * about this one, and treating it as such is how a "tested" connection breaks
 * on activation.
 *
 * ## Rotation is an overlap, not a swap
 *
 * Certificates expire, and the swap cannot be atomic: assertions signed with
 * the old key are in flight while the new one is being installed. So rotation
 * adds a key rather than replacing one, and both verify until the old is
 * retired deliberately. A rotation that replaces immediately rejects every
 * assertion already on the wire — a short outage that looks exactly like a
 * misconfiguration, at the moment somebody is least able to tell the
 * difference.
 *
 * ## Rollback needs somewhere to go
 *
 * `previousConfigurationId` is not optional decoration. A connection that has
 * never been active has nothing to roll back to, and "rollback" that quietly
 * disabled the connection instead would take the tenant down in the name of
 * recovering it.
 */

export const CONNECTION_STATES = [
  /** Typed in, never validated. Cannot authenticate anybody. */
  "DRAFT",
  /** Structurally valid: metadata parsed, certificate readable, endpoints present. */
  "VALIDATED",
  /** A real assertion from the provider was accepted. */
  "TESTED",
  /** Serving sign-ins. */
  "ACTIVE",
  /** Turned off deliberately. Configuration retained. */
  "DISABLED",
] as const

/**
 * Named `ConnectionLifecycleState` rather than `ConnectionState`, which
 * `keying.ts` already uses for a different thing — a connection reduced to what
 * identity resolution needs. Two concepts, and the collision is a real one:
 * this is where a connection *is*, that is what a connection *looks like*.
 */
export type ConnectionLifecycleState = (typeof CONNECTION_STATES)[number]

export type ConnectionAction =
  | "VALIDATE"
  | "TEST"
  | "ACTIVATE"
  | "ROTATE"
  | "DISABLE"
  | "ROLLBACK"

export interface SigningKey {
  id: string
  /** PEM or base64 DER. Compared, never parsed here. */
  certificate: string
  notAfter: string
  /** Retired keys stay for the audit trail and verify nothing. */
  retiredAt: string | null
}

export interface Connection {
  id: string
  tenantId: string
  state: ConnectionLifecycleState
  /**
   * Changes whenever anything an assertion is checked against changes.
   *
   * The pivot of the whole design: a test records the id it ran against, and
   * activation compares. Without it "tested" means "tested at some point",
   * which is not a statement about what is about to go live.
   */
  configurationId: string
  /**
   * The configuration that is, or last was, actually serving sign-ins.
   *
   * Distinct from `configurationId`, which changes the moment somebody edits
   * the metadata — long before the edit goes live. Without the two, ACTIVATE
   * has no way to name what it is replacing: by the time it runs, the outgoing
   * value has already been overwritten.
   */
  activeConfigurationId: string | null
  /** What ROLLBACK returns to. Null until a second configuration is activated. */
  previousConfigurationId: string | null
  signingKeys: readonly SigningKey[]
  /** The configuration the last successful test ran against. */
  lastTest: { configurationId: string; at: string; succeeded: boolean } | null
}

export type TransitionRefusal =
  | "WRONG_STATE"
  | "NO_PASSING_TEST"
  | "TEST_IS_STALE"
  | "NO_LIVE_SIGNING_KEY"
  | "NOTHING_TO_ROLL_BACK_TO"
  | "ALREADY_THERE"

export interface TransitionRefused {
  ok: false
  reason: TransitionRefusal
  detail: string
}

export interface TransitionAccepted {
  ok: true
  connection: Connection
}

export type TransitionOutcome = TransitionAccepted | TransitionRefused

/** Which states each action may be applied from. */
const ALLOWED_FROM: Record<ConnectionAction, readonly ConnectionLifecycleState[]> = {
  // ACTIVE is included so a live connection can stage a new configuration
  // without going out of service. An identity provider rotating its metadata is
  // routine; requiring DISABLE first would mean every routine rotation is an
  // outage, and an outage nobody schedules is one somebody skips.
  VALIDATE: ["DRAFT", "VALIDATED", "TESTED", "ACTIVE"],
  TEST: ["VALIDATED", "TESTED", "ACTIVE"],
  // Deliberately not from VALIDATED. Structural validity says the metadata
  // parses, which is not evidence that the provider will sign anything we can
  // verify.
  // VALIDATED is allowed, and the evidence check below is what refuses — a
  // connection re-validated with an unchanged configuration keeps its passing
  // test and is legitimately activatable. Safety here comes from the evidence,
  // not from the name of the state.
  ACTIVATE: ["VALIDATED", "TESTED", "DISABLED", "ACTIVE"],
  ROTATE: ["ACTIVE", "TESTED", "VALIDATED"],
  DISABLE: ["ACTIVE", "TESTED", "VALIDATED", "DRAFT"],
  ROLLBACK: ["ACTIVE", "DISABLED"],
}

function refuse(reason: TransitionRefusal, detail: string): TransitionRefused {
  return { ok: false, reason, detail }
}

function liveKeys(connection: Connection, at: Date): readonly SigningKey[] {
  return connection.signingKeys.filter(
    (key) => key.retiredAt === null && Date.parse(key.notAfter) > at.getTime(),
  )
}

/**
 * Apply an action to a connection.
 *
 * `at` is passed rather than read, so certificate expiry is decided by the
 * caller's clock and a test can place itself either side of it.
 */
export function applyConnectionAction(
  connection: Connection,
  action: ConnectionAction,
  input: { at: Date; configurationId?: string; testSucceeded?: boolean; newKey?: SigningKey },
): TransitionOutcome {
  const { at } = input

  if (!ALLOWED_FROM[action].includes(connection.state)) {
    return refuse(
      "WRONG_STATE",
      `${action} is not available from ${connection.state}. It applies to ${ALLOWED_FROM[action].join(", ")}.`,
    )
  }

  switch (action) {
    case "VALIDATE": {
      // A new configuration invalidates the old test rather than carrying it
      // forward. Keeping `lastTest` would let a changed certificate inherit the
      // evidence of the one it replaced.
      const configurationId = input.configurationId ?? connection.configurationId
      const changed = configurationId !== connection.configurationId
      return {
        ok: true,
        connection: {
          ...connection,
          // A live connection stays live. It keeps serving
          // `activeConfigurationId` while `configurationId` holds the staged
          // change, which is the whole reason those are two fields.
          state: connection.state === "ACTIVE" ? "ACTIVE" : "VALIDATED",
          configurationId,
          lastTest: changed ? null : connection.lastTest,
        },
      }
    }

    case "TEST": {
      const succeeded = input.testSucceeded === true
      return {
        ok: true,
        connection: {
          ...connection,
          // A failed test does not move the connection backwards — it was
          // already VALIDATED and still is. It records the failure, which is
          // what stops activation. A live connection testing a staged change
          // stays live either way: the test says nothing about the
          // configuration currently serving.
          state: connection.state === "ACTIVE" ? "ACTIVE" : succeeded ? "TESTED" : "VALIDATED",
          lastTest: {
            configurationId: connection.configurationId,
            at: at.toISOString(),
            succeeded,
          },
        },
      }
    }

    case "ACTIVATE": {
      if (!connection.lastTest?.succeeded) {
        return refuse(
          "NO_PASSING_TEST",
          "This connection has never accepted a real assertion. Activating it would find out with the tenant's staff.",
        )
      }
      if (connection.lastTest.configurationId !== connection.configurationId) {
        return refuse(
          "TEST_IS_STALE",
          `The passing test ran against ${connection.lastTest.configurationId}, and this is ` +
            `${connection.configurationId}. Test the configuration being activated, not the one before it.`,
        )
      }
      if (liveKeys(connection, at).length === 0) {
        return refuse(
          "NO_LIVE_SIGNING_KEY",
          "Every signing certificate is retired or expired, so no assertion could be verified.",
        )
      }
      // `previous` becomes what was serving until now, which is why
      // `activeConfigurationId` exists: `configurationId` was overwritten when
      // the metadata was edited, so reading it here would record the incoming
      // configuration as the thing to roll back to — a rollback that returns
      // to exactly where it started.
      //
      // Null on a first activation, and that is correct: nothing was replaced,
      // so there is nothing to roll back to.
      const replaced =
        connection.activeConfigurationId === connection.configurationId
          ? connection.previousConfigurationId
          : connection.activeConfigurationId

      return {
        ok: true,
        connection: {
          ...connection,
          state: "ACTIVE",
          activeConfigurationId: connection.configurationId,
          previousConfigurationId: replaced,
        },
      }
    }

    case "ROTATE": {
      if (!input.newKey) {
        return refuse("NO_LIVE_SIGNING_KEY", "Rotation needs the incoming certificate.")
      }
      if (connection.signingKeys.some((key) => key.id === input.newKey?.id)) {
        return refuse("ALREADY_THERE", `Signing key ${input.newKey.id} is already installed.`)
      }
      // Added, not swapped. Assertions signed with the outgoing key are already
      // on the wire; rejecting them is an outage that looks like a
      // misconfiguration.
      return {
        ok: true,
        connection: {
          ...connection,
          signingKeys: [...connection.signingKeys, input.newKey],
        },
      }
    }

    case "DISABLE": {
      return { ok: true, connection: { ...connection, state: "DISABLED" } }
    }

    case "ROLLBACK": {
      if (connection.previousConfigurationId === null) {
        return refuse(
          "NOTHING_TO_ROLL_BACK_TO",
          "This connection has never been active, so there is no earlier configuration. " +
            "Disabling it is a different decision and has to be made deliberately.",
        )
      }
      if (connection.previousConfigurationId === connection.configurationId) {
        return refuse("ALREADY_THERE", "This is already the previous configuration.")
      }
      return {
        ok: true,
        connection: {
          ...connection,
          configurationId: connection.previousConfigurationId,
          // Nothing is serving after a rollback — the state below says so — but
          // the configuration that *was* serving is what a subsequent ACTIVATE
          // will record as replaced.
          // The rolled-back-from configuration becomes the thing to roll
          // forward to, and the test evidence belongs to neither: it was
          // recorded against the id being left behind.
          previousConfigurationId: connection.configurationId,
          lastTest: null,
          // Back to TESTED rather than ACTIVE. The earlier configuration did
          // work, but this is a recovery, and requiring one deliberate
          // ACTIVATE is what stops a rollback loop from oscillating unattended.
          state: "TESTED",
        },
      }
    }
  }
}

/** Whether this connection may authenticate anybody right now. */
export function connectionServesSignIn(connection: Connection, at: Date): boolean {
  return connection.state === "ACTIVE" && liveKeys(connection, at).length > 0
}

/**
 * The configuration an assertion arriving now must be checked against.
 *
 * `configurationId` is what an operator is editing; `activeConfigurationId` is
 * what is serving. They differ exactly while a change is staged, and validating
 * live traffic against the staged one would apply an untested entity id or ACS
 * URL to everybody signing in.
 */
export function servingConfigurationId(connection: Connection): string | null {
  return connection.state === "ACTIVE" ? connection.activeConfigurationId : null
}

/** Whether a change is staged and waiting to be activated. */
export function hasStagedChange(connection: Connection): boolean {
  return connection.activeConfigurationId !== null && connection.activeConfigurationId !== connection.configurationId
}

/**
 * The certificates an assertion may be verified against.
 *
 * Retired and expired keys are excluded here rather than at the verification
 * site, so there is one answer to "which keys are live" and not one per caller.
 */
export function verificationKeys(connection: Connection, at: Date): readonly SigningKey[] {
  return liveKeys(connection, at)
}
