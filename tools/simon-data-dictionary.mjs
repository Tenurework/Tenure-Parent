#!/usr/bin/env node
/**
 * SIMON-000-014 — the current data dictionary, and the
 * entity/field/key/constraint/index/retention/owner matrix, for BOTH systems.
 *
 *   node tools/simon-data-dictionary.mjs           # write
 *   node tools/simon-data-dictionary.mjs --check   # fail if stale
 *
 * "Both systems" is the pilot (`Tenurework/Tenure`) and this repository, each
 * read at the commit `tools/simon-absorption-inventory.mjs` pinned. The commits
 * are taken out of that generator's own snapshot rather than resolved again, for
 * the reason `tools/simon-convergence-inventory.mjs` states: reading them again
 * would let an analysis silently re-pin the baseline underneath itself, and then
 * two documents describing "the two trees" would be describing three.
 *
 * Nothing here reads a row. A schema is a shape, not data; the source repository
 * carries a live pilot's real student records and rule 8 of the absorption
 * ledger is that a single real row is not evidence whatever it demonstrates.
 * Column names, types, keys and counts are all this opens.
 *
 * ── The two columns that are not in a schema ────────────────────────────────
 *
 * `retention` and `owner` are named by the requirement and neither is
 * expressible in Prisma, so each is DERIVED and the derivation is stated:
 *
 *   retention  the fields on the entity that express a lifetime — a match
 *              against a stated pattern list. An entity with none is
 *              `NONE DECLARED`, which is a finding ("we looked and found
 *              nothing"), not `UNKNOWN` ("we could not look"). The two are
 *              different answers and this repository's standing rule is that
 *              collapsing them is the bug.
 *   owner      the platform domains that read or write the entity, from the
 *              domain table `tools/ownership-map.mjs` already enforces over
 *              file paths, joined through the Prisma client accessor
 *              (`model Foo` is reached as `db.foo` / `prisma.foo`). An entity
 *              nothing accesses is `NO ACCESSOR`, which is also a finding: a
 *              table no code touches is a migration question.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ROOT, SNAPSHOT as BASELINE_SNAPSHOT, byCodepoint, readBlobs } from './simon-absorption-inventory.mjs'
import { DOMAINS } from './ownership-map.mjs'

export { ROOT }

export const SNAPSHOT = 'docs/architecture/simon-data-dictionary.json'
export const DOC = 'docs/architecture/simon-data-dictionary.md'

/** Where each side's schema lives. Same path in both trees, which is itself worth asserting. */
export const SCHEMA_PATH = 'apps/web/prisma/schema.prisma'

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))

/**
 * Fields that express how long a row lives.
 *
 * A stated list, printed beside the table, so "NONE DECLARED" is a claim about
 * a pattern somebody can argue with rather than about a search nobody can see.
 */
export const RETENTION_FIELD_PATTERNS = [
  /^expiresAt$/,
  /^expiry$/i,
  /^retainUntil$/,
  /^retentionUntil$/,
  /^purgeAfter$/,
  /^purgeAt$/,
  /^deletedAt$/,
  /^archivedAt$/,
  /^ttl$/i,
  /^validUntil$/,
]

/**
 * Prisma schema → models, enums, fields, keys, constraints, indexes.
 *
 * Written against the grammar rather than against this schema: a block opens
 * with `model X {` or `enum X {`, a field is `name Type modifiers attributes`,
 * a block attribute starts `@@`. Comments (`//`) and triple-slash doc comments
 * are dropped before anything is matched, because a commented-out field is not
 * a field — the same rule the boundary analyser needs and for the same reason.
 */
export function parseSchema(text) {
  const models = []
  const enums = []
  let block = null
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim()
    if (!line) continue
    const open = line.match(/^(model|enum|type|view)\s+([A-Za-z0-9_]+)\s*\{/)
    if (open) {
      block = { kind: open[1], name: open[2], fields: [], values: [], blockAttributes: [] }
      continue
    }
    if (line === '}') {
      if (block) (block.kind === 'enum' ? enums : models).push(block)
      block = null
      continue
    }
    if (!block) continue
    if (block.kind === 'enum') {
      const value = line.match(/^([A-Za-z0-9_]+)\s*$/)
      if (value) block.values.push(value[1])
      continue
    }
    if (line.startsWith('@@')) {
      block.blockAttributes.push(line)
      continue
    }
    const field = line.match(/^([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)(\[\])?(\?)?\s*(.*)$/)
    if (!field) continue
    const [, name, type, list, optional, rest] = field
    block.fields.push({
      name,
      type,
      list: Boolean(list),
      optional: Boolean(optional),
      attributes: [...rest.matchAll(/@[A-Za-z0-9_.]+(\([^)]*\))?/g)].map((m) => m[0]),
    })
  }
  return { models, enums }
}

const attr = (field, name) => field.attributes.find((a) => a === `@${name}` || a.startsWith(`@${name}(`))

/** The key/constraint/index facts of one entity, each read off the declaration. */
export function entityShape(model) {
  const primary = model.fields.filter((f) => attr(f, 'id')).map((f) => f.name)
  const blockId = model.blockAttributes
    .filter((a) => a.startsWith('@@id'))
    .flatMap((a) => (a.match(/\[([^\]]*)\]/)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  const fieldUnique = model.fields.filter((f) => attr(f, 'unique')).map((f) => [f.name])
  const blockUnique = model.blockAttributes
    .filter((a) => a.startsWith('@@unique'))
    .map((a) => (a.match(/\[([^\]]*)\]/)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  const indexes = model.blockAttributes
    .filter((a) => a.startsWith('@@index'))
    .map((a) => (a.match(/\[([^\]]*)\]/)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  const relations = model.fields
    .filter((f) => attr(f, 'relation'))
    .map((f) => {
      const decl = attr(f, 'relation') ?? ''
      return {
        field: f.name,
        target: f.type,
        fields: (decl.match(/fields:\s*\[([^\]]*)\]/)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
        references: (decl.match(/references:\s*\[([^\]]*)\]/)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
        onDelete: decl.match(/onDelete:\s*([A-Za-z]+)/)?.[1] ?? null,
      }
    })
  const defaults = model.fields.filter((f) => attr(f, 'default')).map((f) => `${f.name}=${attr(f, 'default')}`)
  const retention = model.fields.filter((f) => RETENTION_FIELD_PATTERNS.some((re) => re.test(f.name))).map((f) => f.name)
  return {
    entity: model.name,
    fields: model.fields.length,
    primary_key: primary.length ? primary : blockId,
    unique_constraints: [...fieldUnique, ...blockUnique].map((c) => c.join('+')).sort(byCodepoint),
    indexes: indexes.map((c) => c.join('+')).sort(byCodepoint),
    foreign_keys: relations.filter((r) => r.fields.length).map((r) => `${r.fields.join('+')} → ${r.target}(${r.references.join('+')})${r.onDelete ? ` onDelete:${r.onDelete}` : ''}`).sort(byCodepoint),
    defaults: defaults.sort(byCodepoint),
    retention_fields: retention.sort(byCodepoint),
    mapped_to: model.blockAttributes.find((a) => a.startsWith('@@map'))?.match(/"([^"]+)"/)?.[1] ?? null,
  }
}

/** `model ApprovalRequest` is reached as `db.approvalRequest` / `prisma.approvalRequest`. */
export const accessorOf = (entity) => entity.charAt(0).toLowerCase() + entity.slice(1)

/** Which platform domain owns a path, from the table `tools/ownership-map.mjs` enforces. */
export function domainOf(file) {
  const hits = DOMAINS.filter((d) => d.owns.some((prefix) => file === prefix || file.startsWith(prefix)))
  return hits.length === 1 ? hits[0].key : hits.length > 1 ? 'AMBIGUOUS' : null
}

/**
 * The domains that reach each entity, and the files that do the reaching.
 *
 * Textual, like every other scan in this family: `db.foo.findMany` is found by
 * matching the accessor, so a call made through a variable is invisible to it.
 * The document says so where the table is.
 */
export function accessorsOf(entities, files, contentOf) {
  const out = {}
  for (const e of entities) out[e] = { files: [], domains: [] }
  const source = files.filter((f) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f))
  for (const file of source) {
    const text = contentOf(file)
    if (!text) continue
    for (const e of entities) {
      const re = new RegExp(`\\b(?:db|prisma|tx|client)\\s*\\.\\s*${accessorOf(e)}\\s*\\.`)
      if (re.test(text)) out[e].files.push(file)
    }
  }
  for (const e of entities) {
    out[e].files.sort(byCodepoint)
    out[e].domains = [...new Set(out[e].files.map(domainOf).filter(Boolean))].sort(byCodepoint)
  }
  return out
}

/**
 * The commit each side is read at.
 *
 * The source side is a remote-tracking ref and the baseline records it as
 * `pinned_commit`; the target side is this checkout and the baseline records it
 * as `head_commit`. One key each, taken from the baseline's own snapshot so the
 * two documents describe the same two trees by construction.
 */
export const commitOf = (baselineSide) => baselineSide.pinned_commit ?? baselineSide.head_commit ?? null

function side(label, pinned) {
  const commit = commitOf(pinned)
  if (!commit) {
    return {
      label,
      pinned_commit: null,
      schema_path: SCHEMA_PATH,
      unknown: {
        value: 'UNKNOWN',
        why: `${BASELINE_SNAPSHOT} records neither pinned_commit nor head_commit for the ${label} side`,
        command: `node tools/simon-absorption-inventory.mjs`,
      },
    }
  }
  pinned = { ...pinned, pinned_commit: commit }
  const schemaText = readBlobs(pinned.pinned_commit, [SCHEMA_PATH]).get(SCHEMA_PATH)
  if (!schemaText) {
    return {
      label,
      pinned_commit: pinned.pinned_commit,
      schema_path: SCHEMA_PATH,
      unknown: {
        value: 'UNKNOWN',
        why: `${SCHEMA_PATH} is not present at ${pinned.pinned_commit}`,
        command: `git show ${pinned.pinned_commit}:${SCHEMA_PATH}`,
      },
    }
  }
  const parsed = parseSchema(schemaText)
  const shapes = parsed.models.map(entityShape).sort((a, b) => byCodepoint(a.entity, b.entity))
  const codeFiles = pinned.files.filter((f) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f))
  const blobs = readBlobs(pinned.pinned_commit, codeFiles)
  const access = accessorsOf(shapes.map((s) => s.entity), codeFiles, (f) => blobs.get(f))
  return {
    label,
    pinned_commit: pinned.pinned_commit,
    schema_path: SCHEMA_PATH,
    entities: shapes.map((s) => ({
      ...s,
      accessor: accessorOf(s.entity),
      accessed_by_files: access[s.entity].files.length,
      owner_domains: access[s.entity].domains,
    })),
    enums: parsed.enums
      .map((e) => ({ name: e.name, values: e.values }))
      .sort((a, b) => byCodepoint(a.name, b.name)),
    dictionary: Object.fromEntries(
      parsed.models
        .slice()
        .sort((a, b) => byCodepoint(a.name, b.name))
        .map((m) => [
          m.name,
          m.fields.map((f) => ({
            field: f.name,
            type: f.type + (f.list ? '[]' : '') + (f.optional ? '?' : ''),
            nullable: f.optional,
            attributes: f.attributes,
          })),
        ]),
    ),
  }
}

export function collect() {
  const baseline = readJson(BASELINE_SNAPSHOT)
  const source = side('source', baseline.source)
  const target = side('target', baseline.target)
  const names = (s) => new Set((s.entities ?? []).map((e) => e.entity))
  const inSource = names(source)
  const inTarget = names(target)
  return {
    schema: 1,
    generated_by: 'tools/simon-data-dictionary.mjs',
    closes: ['SIMON-000-014'],
    baseline_snapshot: BASELINE_SNAPSHOT,
    retention_field_patterns: RETENTION_FIELD_PATTERNS.map(String),
    source,
    target,
    comparison: {
      entities_only_in_source: [...inSource].filter((e) => !inTarget.has(e)).sort(byCodepoint),
      entities_only_in_target: [...inTarget].filter((e) => !inSource.has(e)).sort(byCodepoint),
      enums_differing: (source.enums ?? [])
        .map((e) => {
          const other = (target.enums ?? []).find((t) => t.name === e.name)
          if (!other) return null
          const a = e.values.join(',')
          const b = other.values.join(',')
          return a === b ? null : { name: e.name, source: e.values, target: other.values }
        })
        .filter(Boolean),
      entities_with_differing_field_counts: [...inSource]
        .filter((e) => inTarget.has(e))
        .map((e) => {
          const s = source.entities.find((x) => x.entity === e)
          const t = target.entities.find((x) => x.entity === e)
          return s.fields === t.fields ? null : { entity: e, source_fields: s.fields, target_fields: t.fields }
        })
        .filter(Boolean)
        .sort((a, b) => byCodepoint(a.entity, b.entity)),
    },
  }
}

const esc = (s) => String(s).split('|').join('\\|')
const cell = (list) => (list.length ? list.map((x) => `\`${esc(x)}\``).join('<br>') : '—')

function renderSide(s) {
  const L = []
  L.push(`### ${s.label} — \`${s.pinned_commit}\``)
  L.push('')
  if (s.unknown) {
    L.push(`**UNKNOWN** — ${s.unknown.why}. Answer it with \`${s.unknown.command}\`.`)
    L.push('')
    return L
  }
  const noRetention = s.entities.filter((e) => e.retention_fields.length === 0).length
  const noAccessor = s.entities.filter((e) => e.accessed_by_files === 0).length
  L.push(
    `${s.entities.length} entities, ${s.enums.length} enumerations, ` +
      `${s.entities.reduce((n, e) => n + e.fields, 0)} fields. ` +
      `${noRetention} entities declare no retention field; ${noAccessor} have no accessor in the tree.`,
  )
  L.push('')
  L.push('| Entity | Fields | Primary key | Unique constraints | Indexes | Foreign keys | Retention | Owner |')
  L.push('| --- | ---: | --- | --- | --- | --- | --- | --- |')
  for (const e of s.entities) {
    L.push(
      `| \`${e.entity}\` | ${e.fields} | ${cell(e.primary_key)} | ${cell(e.unique_constraints)} | ` +
        `${cell(e.indexes)} | ${cell(e.foreign_keys)} | ` +
        `${e.retention_fields.length ? cell(e.retention_fields) : '**NONE DECLARED**'} | ` +
        `${e.owner_domains.length ? cell(e.owner_domains) : e.accessed_by_files ? '**UNOWNED PATHS**' : '**NO ACCESSOR**'} |`,
    )
  }
  L.push('')
  return L
}

function renderDictionary(s) {
  const L = []
  L.push(`### ${s.label} — field by field`)
  L.push('')
  if (s.unknown) {
    L.push(`**UNKNOWN** — ${s.unknown.why}.`)
    L.push('')
    return L
  }
  for (const [entity, fields] of Object.entries(s.dictionary)) {
    L.push(`#### \`${entity}\``)
    L.push('')
    L.push('| Field | Type | Nullable | Attributes |')
    L.push('| --- | --- | --- | --- |')
    for (const f of fields)
      L.push(`| \`${f.field}\` | \`${esc(f.type)}\` | ${f.nullable ? 'yes' : 'no'} | ${cell(f.attributes)} |`)
    L.push('')
  }
  return L
}

export function render(d) {
  const L = []
  L.push('# Simon absorption — data dictionary and entity matrix')
  L.push('')
  L.push('<!-- Generated by tools/simon-data-dictionary.mjs. Do not edit by hand. -->')
  L.push('')
  L.push('SIMON-000-014. Both systems, each at the commit `tools/simon-absorption-inventory.mjs` pinned.')
  L.push('')
  L.push('No row of data is read. A schema is a shape; the source repository carries a live pilot\'s real records.')
  L.push('')
  L.push('## Entity matrix')
  L.push('')
  L.push(
    '`Retention` lists the fields on the entity that express a lifetime, matched against these patterns: ' +
      d.retention_field_patterns.map((p) => `\`${esc(p)}\``).join(', ') +
      '. An entity with none reads **NONE DECLARED** — a search that found nothing, not a search that was not run.',
  )
  L.push('')
  L.push(
    '`Owner` is the platform domain(s) whose files reach the entity through the Prisma client accessor, ' +
      'resolved with the domain table `tools/ownership-map.mjs` already enforces over file paths. ' +
      'The scan is textual, so an access made through a variable rather than `db.<entity>.` is invisible to it.',
  )
  L.push('')
  L.push(...renderSide(d.source))
  L.push(...renderSide(d.target))
  L.push('## What differs between the two schemas')
  L.push('')
  L.push(`Entities only in the source: ${cell(d.comparison.entities_only_in_source)}`)
  L.push('')
  L.push(`Entities only in the target: ${cell(d.comparison.entities_only_in_target)}`)
  L.push('')
  L.push(`Entities whose field count differs: **${d.comparison.entities_with_differing_field_counts.length}**.`)
  L.push('')
  if (d.comparison.entities_with_differing_field_counts.length) {
    L.push('| Entity | Source fields | Target fields |')
    L.push('| --- | ---: | ---: |')
    for (const c of d.comparison.entities_with_differing_field_counts)
      L.push(`| \`${c.entity}\` | ${c.source_fields} | ${c.target_fields} |`)
    L.push('')
  }
  L.push(`Enumerations carried by both trees with different members: **${d.comparison.enums_differing.length}**.`)
  L.push('')
  if (d.comparison.enums_differing.length) {
    L.push('| Enumeration | Source members | Target members |')
    L.push('| --- | --- | --- |')
    for (const e of d.comparison.enums_differing)
      L.push(`| \`${e.name}\` | ${cell(e.source)} | ${cell(e.target)} |`)
    L.push('')
  }
  L.push('## Data dictionary')
  L.push('')
  L.push(...renderDictionary(d.source))
  L.push(...renderDictionary(d.target))
  return L.join('\n') + '\n'
}

function main() {
  const d = collect()
  const doc = render(d)
  const snap = JSON.stringify(d, null, 2) + '\n'
  const check = process.argv.includes('--check')
  const files = [
    [DOC, doc],
    [SNAPSHOT, snap],
  ]
  if (check) {
    for (const [rel, want] of files) {
      const full = path.join(ROOT, rel)
      const have = fs.existsSync(full) ? fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n') : ''
      if (have !== want) {
        console.error(`stale — ${rel} is not what the pinned trees now say. Re-run without --check.`)
        process.exit(1)
      }
    }
    console.log(`ok — 2 artifacts match the pinned trees`)
  } else {
    for (const [rel, want] of files) {
      fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true })
      fs.writeFileSync(path.join(ROOT, rel), want)
    }
    console.log(`wrote ${DOC} and ${SNAPSHOT}`)
  }
  const n = (s) => (s.entities ? s.entities.length : 'UNKNOWN')
  console.log(
    `data dictionary: source ${n(d.source)} entities, target ${n(d.target)}; ` +
      `${d.comparison.entities_only_in_target.length} target-only, ` +
      `${d.comparison.entities_with_differing_field_counts.length} with differing field counts, ` +
      `${d.comparison.enums_differing.length} enumerations differing`,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
