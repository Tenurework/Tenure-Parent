/**
 * The sort key a configuration revision is stored under.
 *
 * Its own module, with no `server-only`, so the padding can be tested without a
 * server. That is not a workaround: the padding is pure string formatting and
 * has nothing to do with DynamoDB — the store imports it, and the test imports
 * it, and neither needs the other.
 *
 * Zero-padded, because DynamoDB sorts sort keys lexicographically. Unpadded,
 * `CONFIG#10` sorts before `CONFIG#9` and a version history silently reorders
 * itself at the tenth revision — invisible until a rollback picks the wrong
 * target.
 */
export const REVISION_WIDTH = 8

export const configSortKey = (revision: number) =>
  `CONFIG#${String(revision).padStart(REVISION_WIDTH, "0")}`

export const CONFIG_SORT_PREFIX = "CONFIG#"
