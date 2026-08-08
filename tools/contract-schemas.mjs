#!/usr/bin/env node
/**
 * Write `docs/contracts/*.schema.json` from the contracts package.
 *
 * STUDIO-130-001 asks for published, versioned control-plane contracts. The
 * publishable artefact is a JSON Schema — something a producer in another
 * language can validate against — and the thing that makes a published schema
 * worth anything is that it says what the code actually enforces.
 *
 * So it is not written by hand beside the parser. `packages/contracts/src/index.ts`
 * declares `CONTROL_PLANE_SCHEMAS` between two markers, in JSON-compatible
 * syntax, and the parsers RUN that object rather than restating it. This script
 * lifts the same text out and writes it to disk with a `$schema` and a `$id`
 * carrying the contract version. There is one source; the file on disk is its
 * output, and `tests/architecture/contracts-schemas-match-parsers.test.mjs`
 * fails if the committed output is not what this produces today.
 *
 * Text extraction rather than `import`, because CI pins Node 20 and this is a
 * TypeScript file. `--experimental-strip-types` is Node 22. The markers make
 * the extraction exact rather than a guess at where an object literal ends.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

const SOURCE = 'packages/contracts/src/index.ts'
const OUT_DIR = 'docs/contracts'

const BEGIN = 'control-plane-schemas:begin'
const END = 'control-plane-schemas:end'

/** The literal between the markers, as data. Throws rather than guessing. */
export function readSchemas(sourceText) {
  const from = sourceText.indexOf(BEGIN)
  const to = sourceText.indexOf(END)
  if (from === -1 || to === -1 || to < from) {
    throw new Error(`${SOURCE} no longer carries the ${BEGIN}/${END} markers — this generator is not reading it.`)
  }
  const slice = sourceText.slice(from, to)
  const open = slice.indexOf('{')
  const close = slice.lastIndexOf('}')
  if (open === -1 || close === -1) throw new Error(`No object literal between the markers in ${SOURCE}.`)
  return JSON.parse(slice.slice(open, close + 1))
}

/** The version table, so `$id` and the parser cannot disagree about it. */
export function readVersions(sourceText) {
  const m = /export const CONTROL_PLANE_SCHEMA_VERSIONS = \{([\s\S]*?)\n\} as const/.exec(sourceText)
  if (!m) throw new Error(`${SOURCE} no longer exports CONTROL_PLANE_SCHEMA_VERSIONS in the expected shape.`)
  const out = {}
  for (const [, name, version] of m[1].matchAll(/(\w+):\s*"([\d.]+)"/g)) out[name] = version
  return out
}

/** `EstateResource` → `estate-resource`. The file name an operator would guess. */
export function fileNameFor(contract) {
  return contract.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/** The document written to disk, given the schema and its version. */
export function document(contract, schema, version) {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://contracts.tenure.dev/control-plane/${fileNameFor(contract)}/${version}.schema.json`,
    'x-contract': contract,
    'x-contract-version': version,
    'x-generated-by': `tools/contract-schemas.mjs from ${SOURCE}`,
    ...schema,
  }
}

/* ------------------------------------------------------------- OpenAPI -- */

/**
 * The routes the OpenAPI document describes, and the ONE place they are listed.
 *
 * Every entry here is checked against the running code by
 * `tests/architecture/contracts-schemas-match-parsers.test.mjs`: `surface` must
 * be a key of `SURFACES` in `apps/system-studio/src/lib/aws/result.ts`, and the
 * file serving it must exist. That check is what keeps this an API description
 * rather than an API proposal — an OpenAPI document listing an endpoint nobody
 * implemented is worse than none, because a client generated from it compiles.
 *
 * `/api/aws/{surface}` is one Next.js dynamic route. It is expanded per surface
 * rather than published with a path parameter, because the three surfaces do
 * not accept the same query parameters or return the same items, and a single
 * templated path would have to describe the union — which describes none of
 * them.
 */
export const CONTROL_PLANE_ROUTES = [
  {
    surface: 'fleet',
    path: '/api/aws/fleet',
    methods: ['get'],
    summary: 'Every tenant this operator may read.',
    description:
      'One page of the tenant registry. `format=csv` returns text/csv with an `x-refused-count` header ' +
      'naming how many tenants were withheld by authorization rather than silently dropped.',
    query: ['limit', 'cursor', 'format'],
  },
  {
    surface: 'operations',
    path: '/api/aws/operations',
    methods: ['get', 'post'],
    summary: "One tenant's long-running lifecycle operations, and the way to start one.",
    description:
      'GET requires `slug`. POST requires an `Idempotency-Key` header and runs the same server action the ' +
      'console form runs, so no control the browser path enforces can be skipped over HTTP.',
    query: ['slug', 'limit', 'cursor'],
  },
  {
    surface: 'cost',
    path: '/api/aws/cost',
    methods: ['get'],
    summary: 'Allocated spend per tenant.',
    description:
      'Answers 501 when no cost source is connected. Never 200 with an empty list — "we looked and there ' +
      'is nothing" and "nothing was connected to look at" are opposite facts about a fleet\'s bill.',
    query: [],
  },
]

/** The problem types the routes can return, keyed as `problem.ts` keys them. */
const PROBLEM_RESPONSES = {
  400: 'badRequest',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'notFound',
  405: 'notFound',
  409: 'conflict',
  429: 'rateLimited',
  501: 'surfaceNotConfigured',
  502: 'internal',
}

const QUERY_PARAMETERS = {
  limit: { description: 'Rows per page, capped by the platform ceiling (MAX_PAGE).', schema: { type: 'integer', minimum: 1 } },
  cursor: { description: 'Opaque continuation token. AES-256-GCM sealed; not decodable by a client.', schema: { type: 'string' } },
  format: { description: 'Set to `csv` for a text/csv export.', schema: { type: 'string', enum: ['csv'] } },
  slug: { description: 'The tenant. Required — operations are per tenant.', schema: { type: 'string' } },
}

/**
 * The OpenAPI 3.1 description of the control plane's HTTP face.
 *
 * Generated, never hand-written, and generated from the SAME
 * `CONTROL_PLANE_SCHEMAS` the parsers run — so the envelope this document
 * promises and the envelope `envelope()` refuses to build are one object.
 */
export function openapi(schemas, versions) {
  const paths = {}
  for (const route of CONTROL_PLANE_ROUTES) {
    const operations = {}
    for (const method of route.methods) {
      const isWrite = method === 'post'
      operations[method] = {
        operationId: `${method}${route.surface[0].toUpperCase()}${route.surface.slice(1)}`,
        summary: route.summary,
        description: route.description,
        parameters: route.query.map((name) => ({
          name,
          in: 'query',
          required: name === 'slug' && !isWrite,
          ...QUERY_PARAMETERS[name],
        })),
        ...(isWrite
          ? {
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['slug', 'to'],
                      properties: {
                        slug: { type: 'string' },
                        to: { type: 'string', description: 'The lifecycle state to advance to.' },
                        approvedBy: { type: 'string' },
                        ownerPrincipalId: { type: 'string' },
                        reason: { type: 'string' },
                        expectedVersion: { type: 'string' },
                        expectedDigest: { type: 'string' },
                        confirmTarget: { type: 'string' },
                        riskDigest: { type: 'string' },
                      },
                    },
                  },
                },
              },
            }
          : {}),
        responses: {
          200: {
            description: isWrite
              ? 'Accepted. A replay returns 200 as well — two identical requests that returned different statuses would make the second look like a different outcome.'
              : 'One page.',
            content: {
              'application/json': {
                schema: isWrite
                  ? {
                      type: 'object',
                      required: ['operationId', 'replayed', 'error', 'correlationId'],
                      properties: {
                        operationId: { type: ['string', 'null'] },
                        replayed: { type: 'boolean' },
                        error: { type: ['string', 'null'] },
                        correlationId: { type: 'string' },
                      },
                    }
                  : { $ref: '#/components/schemas/ApiEnvelope' },
              },
            },
          },
          ...(isWrite
            ? {}
            : {
                304: { description: 'The ETag matched. No body, deliberately.' },
              }),
          ...Object.fromEntries(
            Object.entries(PROBLEM_RESPONSES)
              // 405 belongs only to the write path's read-only surfaces; 409
              // only to a write.
              .filter(([status]) => (status === '409' ? isWrite : status === '405' ? isWrite : true))
              .map(([status, problem]) => [
                status,
                {
                  description: problem,
                  content: {
                    'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDocument' } },
                  },
                },
              ]),
          ),
        },
      }
    }
    paths[route.path] = operations
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Tenure System Studio — control plane',
      version: versions.ApiEnvelope,
      description:
        'The Studio\'s HTTP face. Every 2xx read is an ApiEnvelope; every non-2xx is RFC 7807 problem+json, ' +
        'and there is no other way to produce one. Generated by tools/contract-schemas.mjs from ' +
        `${SOURCE} — the component schemas below are the objects the runtime parsers execute, not a ` +
        'description of them.',
    },
    servers: [{ url: '/', description: 'The Studio origin. Never a tenant origin (PD-007).' }],
    components: {
      securitySchemes: {
        operatorSession: {
          type: 'apiKey',
          in: 'cookie',
          name: 'authjs.session-token',
          description: 'An operator session. There is no API key and no bearer token; every route calls auth().',
        },
      },
      schemas: {
        ...Object.fromEntries(
          Object.entries(schemas).map(([name, schema]) => [
            name,
            { ...schema, 'x-contract-version': versions[name] },
          ]),
        ),
        ProblemDocument: {
          title: 'ProblemDocument',
          description: 'RFC 7807. The only non-2xx body this control plane produces.',
          type: 'object',
          additionalProperties: false,
          required: ['type', 'title', 'status', 'detail', 'instance', 'correlationId'],
          properties: {
            type: { type: 'string', format: 'uri' },
            title: { type: 'string' },
            status: { type: 'integer' },
            detail: { type: 'string' },
            instance: { type: 'string' },
            correlationId: { type: 'string' },
          },
        },
      },
    },
    security: [{ operatorSession: [] }],
    paths,
  }
}

export function generate(sourceText) {
  const schemas = readSchemas(sourceText)
  const versions = readVersions(sourceText)
  const files = {}
  for (const [contract, schema] of Object.entries(schemas)) {
    const version = versions[contract]
    if (!version) throw new Error(`${contract} has a schema but no entry in CONTROL_PLANE_SCHEMA_VERSIONS.`)
    files[`${fileNameFor(contract)}.schema.json`] = `${JSON.stringify(document(contract, schema, version), null, 2)}\n`
  }
  files['control-plane.openapi.json'] = `${JSON.stringify(openapi(schemas, versions), null, 2)}\n`
  return files
}

/** Run only when invoked directly; the test above imports the functions. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = fs.readFileSync(path.join(ROOT, SOURCE), 'utf8')
  const files = generate(source)
  fs.mkdirSync(path.join(ROOT, OUT_DIR), { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(ROOT, OUT_DIR, name), text)
    console.log(`wrote ${OUT_DIR}/${name}`)
  }
}

export { ROOT, SOURCE, OUT_DIR }
