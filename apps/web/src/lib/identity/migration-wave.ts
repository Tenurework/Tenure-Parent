import {
  MIGRATION_WAVES,
  isMigrationWave,
  localLoginPermitted,
  recoveryPath,
  ssoOffered,
  type MigrationWave,
  type RecoveryPath,
} from "@tenure/identity"

/**
 * IER-100-008 — this cell's position in the SSO migration, and what the sign-in
 * page may therefore draw.
 *
 * The engine (`@tenure/identity`'s `sso-migration.ts`) decides what a wave
 * means. This module answers only *which wave this deployment is in*, and it
 * reads that from the environment for the same reason `auth-connections.ts`
 * reads its identity connections there: for this cell the environment IS the
 * registry — the value is set by the task definition, and a second copy in a
 * table would be a second answer to the same question.
 *
 * ## Three states, and the third is the one that matters
 *
 * 1. **Unset.** No migration is configured. The wave imposes nothing and the
 *    identity registry decides what is offered, exactly as it does today. This
 *    is the pilot's state and nothing about it changes.
 * 2. **A recognised wave.** Its consequences apply.
 * 3. **Set to something that is not a wave.** This is NOT state 1. Somebody
 *    typed a value meaning to restrict something, and reading an unparseable
 *    restriction as "no restriction" is the failure this codebase keeps finding:
 *    "we looked and found nothing" and "we could not look" are different
 *    answers. So the local method is withheld and the reason is stated, rather
 *    than the control silently evaporating.
 *
 * The federated method is deliberately NOT withheld in state 3: withholding both
 * leaves a page with no way in at all, which turns a typo into an outage. The
 * asymmetry is the point — fail closed on the method the migration is retiring,
 * fail open on the one it is moving to.
 */

/** Any environment-shaped bag. `process.env` satisfies it. */
export type WaveEnvironment = Readonly<Record<string, string | undefined>>

/** The variable the task definition sets. Named here once. */
export const MIGRATION_WAVE_VARIABLE = "SSO_MIGRATION_WAVE"

export interface CellMigrationWave {
  /** The configured wave, or null when none is configured or the value is not one. */
  wave: MigrationWave | null
  /**
   * Why there is no wave, when the value was set and could not be read. Null
   * when nothing is configured — which is a different thing and must stay so.
   */
  problem: string | null
  /** Whether the local (password / invitation) method may be offered. */
  localLoginPermitted: boolean
  /** Whether the federated method may be offered to a person who is not signed in. */
  ssoOffered: boolean
  /** What to tell somebody who cannot get in. Null when no migration is running. */
  recovery: RecoveryPath | null
}

/**
 * Read the wave, and derive the two things the sign-in page needs.
 *
 * A person arriving at the public sign-in page is `PRODUCTION` by construction:
 * nothing is known about them yet, so `TEST_IDP` must not offer them a test
 * provider. Non-production audiences reach a test IdP through a route that has
 * already established who they are.
 */
export function cellMigrationWave(env: WaveEnvironment = process.env): CellMigrationWave {
  const configured = env[MIGRATION_WAVE_VARIABLE]?.trim()

  if (!configured) {
    return {
      wave: null,
      problem: null,
      localLoginPermitted: true,
      ssoOffered: true,
      recovery: null,
    }
  }

  if (!isMigrationWave(configured)) {
    return {
      wave: null,
      problem:
        `${MIGRATION_WAVE_VARIABLE} is set to "${configured}", which is not a migration wave. ` +
        `The local sign-in method is withheld until it is one of: ${MIGRATION_WAVES.join(", ")}. ` +
        `A restriction that cannot be read is not the same as no restriction.`,
      localLoginPermitted: false,
      ssoOffered: true,
      recovery: null,
    }
  }

  return {
    wave: configured,
    problem: null,
    localLoginPermitted: localLoginPermitted(configured),
    ssoOffered: ssoOffered(configured, "PRODUCTION"),
    recovery: recoveryPath(configured),
  }
}
