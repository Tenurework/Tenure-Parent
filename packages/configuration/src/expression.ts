/**
 * GE-031-005 — a bounded, deterministic expression language.
 *
 * Bible §17.4: "Custom expressions use a bounded deterministic expression
 * language with no network, file, process, reflection, secret, or arbitrary
 * code access. Expression execution has cost/time limits, dependency analysis,
 * cycle detection, test fixtures, versioning, and reproducibility."
 *
 * ## Why this is a parser and not `eval`
 *
 * Every shortcut to running a tenant-authored string — `eval`, `new Function`,
 * a template library, a "safe" sandbox that hands over real objects — gives up
 * the requirement in the first clause. The canonical escape is one expression
 * long:
 *
 *     ({}).constructor.constructor("return process")().env
 *
 * No allowlist of *global names* stops it, because nothing global is named:
 * it walks from an object literal to `Function` through prototypes. The only
 * defence that holds is never evaluating host code at all, so this tokenizes,
 * parses to a closed AST of eleven node kinds, type-checks, and walks the tree.
 * A value can only enter through the declared environment, and the evaluator
 * has no way to reach a property that was not put there — member access is
 * resolved against plain data with the prototype chain explicitly excluded.
 *
 * ## Bounded in four dimensions, because one is not enough
 *
 * Source length, token count, AST depth and evaluation steps. Depth alone lets
 * `1+1+1+…` past; step count alone lets a deeply nested expression blow the
 * JavaScript stack during *parsing*, before any step is counted. Each limit is
 * the cheapest place to catch its own failure.
 *
 * ## Deterministic by construction
 *
 * There is no clock, no randomness, no locale and no iteration over object keys
 * in the language. The same expression against the same environment produces
 * the same value in every process and every region — which is what makes a
 * configuration digest (GE-031-003) mean anything when expressions are in it.
 */

import { adjacencyOf, minimalCyclePaths } from "./graph"

export const EXPRESSION_LANGUAGE_VERSION = "1.0.0"

export type ExprType = "number" | "string" | "boolean" | "null"

export interface Limits {
  /** Characters. The first gate, before a tokenizer has done any work. */
  maxLength: number
  maxTokens: number
  /** Parser recursion. Guards the host stack, which a step counter cannot. */
  maxDepth: number
  /** Evaluation steps — one per node visited. The cost limit. */
  maxSteps: number
}

export const DEFAULT_LIMITS: Limits = {
  maxLength: 2_000,
  maxTokens: 400,
  maxDepth: 32,
  maxSteps: 2_000,
}

export class ExpressionError extends Error {
  constructor(
    message: string,
    readonly phase: "parse" | "type" | "evaluate",
    /** Character offset, where the phase knows one. */
    readonly at?: number,
  ) {
    super(message)
    this.name = "ExpressionError"
  }
}

// ── Tokens ───────────────────────────────────────────────────────────────────

type TokenKind = "number" | "string" | "name" | "punct"
interface Token {
  kind: TokenKind
  value: string
  at: number
}

const PUNCT = [
  "&&",
  "||",
  "==",
  "!=",
  "<=",
  ">=",
  "(",
  ")",
  ",",
  ".",
  "?",
  ":",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
  "!",
] as const

export function tokenize(source: string, limits: Limits = DEFAULT_LIMITS): Token[] {
  if (source.length > limits.maxLength) {
    throw new ExpressionError(
      `Expression is ${source.length} characters; the limit is ${limits.maxLength}.`,
      "parse",
    )
  }

  const tokens: Token[] = []
  let i = 0

  while (i < source.length) {
    const char = source[i]

    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      i++
      continue
    }

    if (char >= "0" && char <= "9") {
      const start = i
      while (i < source.length && source[i] >= "0" && source[i] <= "9") i++
      if (source[i] === ".") {
        i++
        while (i < source.length && source[i] >= "0" && source[i] <= "9") i++
      }
      // `1e400` is Infinity, and a literal that is not a finite number is a
      // determinism hole rather than a big number.
      const text = source.slice(start, i)
      if (!Number.isFinite(Number(text))) {
        throw new ExpressionError(`"${text}" is not a finite number.`, "parse", start)
      }
      tokens.push({ kind: "number", value: text, at: start })
      continue
    }

    if (char === '"' || char === "'") {
      const start = i
      const quote = char
      i++
      let value = ""
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          const next = source[i + 1]
          // A closed escape set. `\u` and `\x` are absent on purpose: they let a
          // reviewer read one string and a parser see another, which is how a
          // review of a tenant-authored expression stops being worth anything.
          const mapped = next === "n" ? "\n" : next === "t" ? "\t" : next === "\\" ? "\\" : next === quote ? quote : null
          if (mapped === null) {
            throw new ExpressionError(`Unsupported escape "\\${next ?? ""}".`, "parse", i)
          }
          value += mapped
          i += 2
          continue
        }
        value += source[i]
        i++
      }
      if (i >= source.length) throw new ExpressionError("Unterminated string.", "parse", start)
      i++
      tokens.push({ kind: "string", value, at: start })
      continue
    }

    if (/[A-Za-z_]/.test(char)) {
      const start = i
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) i++
      tokens.push({ kind: "name", value: source.slice(start, i), at: start })
      continue
    }

    const two = source.slice(i, i + 2)
    const punct = (PUNCT as readonly string[]).includes(two)
      ? two
      : (PUNCT as readonly string[]).includes(char)
        ? char
        : null
    if (punct === null) {
      throw new ExpressionError(`Unexpected character ${JSON.stringify(char)}.`, "parse", i)
    }
    tokens.push({ kind: "punct", value: punct, at: i })
    i += punct.length

    if (tokens.length > limits.maxTokens) {
      throw new ExpressionError(`Expression has more than ${limits.maxTokens} tokens.`, "parse")
    }
  }

  if (tokens.length > limits.maxTokens) {
    throw new ExpressionError(`Expression has more than ${limits.maxTokens} tokens.`, "parse")
  }
  return tokens
}

// ── AST ──────────────────────────────────────────────────────────────────────

export type Node =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "null" }
  | { kind: "var"; path: readonly string[] }
  | { kind: "unary"; op: "-" | "!"; operand: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "logical"; op: "&&" | "||"; left: Node; right: Node }
  | { kind: "conditional"; test: Node; then: Node; otherwise: Node }
  | { kind: "call"; name: string; args: readonly Node[] }

/**
 * The functions the language has. There is no way to add one from a tenant
 * expression, and every one is pure: same arguments, same result, no clock, no
 * locale, no I/O.
 */
interface Fn {
  params: readonly ExprType[] | "variadic"
  /** For variadic functions, the type every argument must have. */
  variadicOf?: ExprType
  returns: ExprType
  apply: (args: readonly unknown[]) => unknown
}

const asNumber = (v: unknown) => v as number
const asString = (v: unknown) => v as string

export const FUNCTIONS: Readonly<Record<string, Fn>> = {
  min: { params: "variadic", variadicOf: "number", returns: "number", apply: (a) => Math.min(...a.map(asNumber)) },
  max: { params: "variadic", variadicOf: "number", returns: "number", apply: (a) => Math.max(...a.map(asNumber)) },
  abs: { params: ["number"], returns: "number", apply: (a) => Math.abs(asNumber(a[0])) },
  floor: { params: ["number"], returns: "number", apply: (a) => Math.floor(asNumber(a[0])) },
  ceil: { params: ["number"], returns: "number", apply: (a) => Math.ceil(asNumber(a[0])) },
  // Half away from zero, stated rather than inherited: JavaScript's `Math.round`
  // sends -0.5 to -0, so two engines agreeing on "round" is not a given.
  round: {
    params: ["number"],
    returns: "number",
    apply: (a) => {
      const n = asNumber(a[0])
      return n < 0 ? -Math.round(-n) : Math.round(n)
    },
  },
  len: { params: ["string"], returns: "number", apply: (a) => asString(a[0]).length },
  // Locale-independent on purpose. `toLocaleLowerCase` maps a Turkish capital I
  // to a dotless i, so the same expression would resolve differently for two
  // tenants — which is exactly the reproducibility this item is about.
  lower: { params: ["string"], returns: "string", apply: (a) => asString(a[0]).toLowerCase() },
  upper: { params: ["string"], returns: "string", apply: (a) => asString(a[0]).toUpperCase() },
  contains: {
    params: ["string", "string"],
    returns: "boolean",
    apply: (a) => asString(a[0]).includes(asString(a[1])),
  },
}

// ── Parser ───────────────────────────────────────────────────────────────────

/** Names that may never be a variable path segment. */
const FORBIDDEN_SEGMENTS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  // Not reachable through this evaluator, and refused at parse time anyway so
  // an expression that *tries* is visible in review rather than merely inert.
  "process",
  "global",
  "globalThis",
  "require",
  "module",
  "eval",
  "Function",
])

export function parse(source: string, limits: Limits = DEFAULT_LIMITS): Node {
  const tokens = tokenize(source, limits)
  let position = 0
  let depth = 0

  const peek = () => tokens[position]
  const at = () => peek()?.at
  const isPunct = (value: string) => peek()?.kind === "punct" && peek().value === value
  const eat = (value: string) => {
    if (!isPunct(value)) {
      throw new ExpressionError(`Expected "${value}".`, "parse", at())
    }
    position++
  }

  const deeper = <T>(fn: () => T): T => {
    depth++
    if (depth > limits.maxDepth) {
      throw new ExpressionError(`Expression nests deeper than ${limits.maxDepth}.`, "parse", at())
    }
    try {
      return fn()
    } finally {
      depth--
    }
  }

  function primary(): Node {
    const token = peek()
    if (!token) throw new ExpressionError("Expression ended early.", "parse")

    if (token.kind === "number") {
      position++
      return { kind: "number", value: Number(token.value) }
    }
    if (token.kind === "string") {
      position++
      return { kind: "string", value: token.value }
    }
    if (token.kind === "name") {
      if (token.value === "true" || token.value === "false") {
        position++
        return { kind: "boolean", value: token.value === "true" }
      }
      if (token.value === "null") {
        position++
        return { kind: "null" }
      }
      // A call, or a dotted variable path.
      if (tokens[position + 1]?.kind === "punct" && tokens[position + 1].value === "(") {
        const name = token.value
        position += 2
        const args: Node[] = []
        if (!isPunct(")")) {
          args.push(deeper(expression))
          while (isPunct(",")) {
            position++
            args.push(deeper(expression))
          }
        }
        eat(")")
        return { kind: "call", name, args }
      }

      const path: string[] = [token.value]
      position++
      while (isPunct(".")) {
        position++
        const segment = peek()
        if (segment?.kind !== "name") {
          throw new ExpressionError("Expected a name after \".\".", "parse", at())
        }
        path.push(segment.value)
        position++
      }
      for (const segment of path) {
        if (FORBIDDEN_SEGMENTS.has(segment)) {
          throw new ExpressionError(
            `"${segment}" may not appear in a path. Reflection is not part of this language.`,
            "parse",
            token.at,
          )
        }
      }
      return { kind: "var", path }
    }

    if (token.value === "(") {
      position++
      const inner = deeper(expression)
      eat(")")
      return inner
    }
    if (token.value === "-" || token.value === "!") {
      position++
      return { kind: "unary", op: token.value as "-" | "!", operand: deeper(unary) }
    }
    throw new ExpressionError(`Unexpected "${token.value}".`, "parse", token.at)
  }

  function unary(): Node {
    return primary()
  }

  /** Precedence climbing. Higher binds tighter. */
  const BINARY: Record<string, number> = {
    "*": 7,
    "/": 7,
    "%": 7,
    "+": 6,
    "-": 6,
    "<": 5,
    "<=": 5,
    ">": 5,
    ">=": 5,
    "==": 4,
    "!=": 4,
  }

  function binary(minPrecedence: number): Node {
    let left = deeper(unary)
    for (;;) {
      const token = peek()
      if (!token || token.kind !== "punct") break
      const precedence = BINARY[token.value]
      if (precedence === undefined || precedence < minPrecedence) break
      position++
      const right = deeper(() => binary(precedence + 1))
      left = { kind: "binary", op: token.value, left, right }
    }
    return left
  }

  function logical(): Node {
    let left = binary(0)
    while (isPunct("&&") || isPunct("||")) {
      const op = peek().value as "&&" | "||"
      position++
      const right = deeper(() => binary(0))
      left = { kind: "logical", op, left, right }
    }
    return left
  }

  function expression(): Node {
    const test = logical()
    if (!isPunct("?")) return test
    position++
    const then = deeper(expression)
    eat(":")
    const otherwise = deeper(expression)
    return { kind: "conditional", test, then, otherwise }
  }

  const root = expression()
  if (position < tokens.length) {
    throw new ExpressionError(`Unexpected "${peek().value}" after the expression.`, "parse", at())
  }
  return root
}

// ── Dependencies and cycles ──────────────────────────────────────────────────

/** Every variable path an expression reads, dotted, sorted, de-duplicated. */
export function dependencies(node: Node): readonly string[] {
  const found = new Set<string>()
  const walk = (n: Node) => {
    switch (n.kind) {
      case "var":
        found.add(n.path.join("."))
        return
      case "unary":
        return walk(n.operand)
      case "binary":
      case "logical":
        walk(n.left)
        return walk(n.right)
      case "conditional":
        walk(n.test)
        walk(n.then)
        return walk(n.otherwise)
      case "call":
        for (const arg of n.args) walk(arg)
        return
      default:
        return
    }
  }
  walk(node)
  return [...found].sort()
}

/**
 * Cycles among named expressions that reference each other.
 *
 * `a = b + 1`, `b = a + 1` has no answer, and evaluating it recurses until the
 * host stack gives out — a crash in a request handler rather than a rejected
 * configuration. Reported as the path that forms the cycle, once per cycle.
 */
export function expressionCycles(expressions: Readonly<Record<string, string>>): readonly string[] {
  const asts = new Map<string, Node>()
  for (const [name, source] of Object.entries(expressions)) asts.set(name, parse(source))

  // Only a dependency that is itself an expression can form a cycle; a reference
  // to plain environment data terminates.
  //
  // The traversal itself is `graph.ts`. It used to be a depth-first search
  // written out here, duplicating the one in `rejections.ts`, and both reported
  // whichever cycle the traversal closed first rather than the SHORTEST one that
  // Bible §11 step 6 asks for.
  return minimalCyclePaths(
    adjacencyOf(
      [...asts].map(([name, ast]) => [name, dependencies(ast).filter((d) => asts.has(d))] as const),
    ),
  )
}

// ── Type checking ────────────────────────────────────────────────────────────

export type TypeEnv = Readonly<Record<string, ExprType>>

/**
 * The type an expression produces, or an error saying why it has none.
 *
 * Static, before any evaluation. `1 + true` is a defect in the configuration
 * and should be caught when it is published, not when a request hits the one
 * branch that reaches it.
 */
export function typeOf(node: Node, env: TypeEnv): ExprType {
  switch (node.kind) {
    case "number":
    case "string":
    case "boolean":
    case "null":
      return node.kind

    case "var": {
      const path = node.path.join(".")
      const type = env[path]
      if (!type) {
        throw new ExpressionError(
          `"${path}" is not declared. Every name must be in the environment, so an expression cannot reach anything nobody offered it.`,
          "type",
        )
      }
      return type
    }

    case "unary": {
      const operand = typeOf(node.operand, env)
      if (node.op === "-") {
        if (operand !== "number") throw new ExpressionError(`Cannot negate a ${operand}.`, "type")
        return "number"
      }
      if (operand !== "boolean") throw new ExpressionError(`Cannot apply "!" to a ${operand}.`, "type")
      return "boolean"
    }

    case "binary": {
      const left = typeOf(node.left, env)
      const right = typeOf(node.right, env)
      if (node.op === "==" || node.op === "!=") {
        // Comparing different types is always a mistake rather than always
        // false: nothing useful asks whether a number equals a string.
        if (left !== right) {
          throw new ExpressionError(`Cannot compare a ${left} with a ${right}.`, "type")
        }
        return "boolean"
      }
      if (node.op === "+" && left === "string" && right === "string") return "string"
      if (left !== "number" || right !== "number") {
        throw new ExpressionError(`"${node.op}" needs numbers, not a ${left} and a ${right}.`, "type")
      }
      return node.op === "<" || node.op === "<=" || node.op === ">" || node.op === ">=" ? "boolean" : "number"
    }

    case "logical": {
      const left = typeOf(node.left, env)
      const right = typeOf(node.right, env)
      // No truthiness. `"" || "fallback"` reads as a default and would depend on
      // JavaScript's coercion rules, which tenant authors have no reason to know.
      if (left !== "boolean" || right !== "boolean") {
        throw new ExpressionError(`"${node.op}" needs booleans, not a ${left} and a ${right}.`, "type")
      }
      return "boolean"
    }

    case "conditional": {
      const test = typeOf(node.test, env)
      if (test !== "boolean") throw new ExpressionError(`A condition must be boolean, not a ${test}.`, "type")
      const then = typeOf(node.then, env)
      const otherwise = typeOf(node.otherwise, env)
      if (then !== otherwise) {
        throw new ExpressionError(
          `Both branches must have one type; this yields a ${then} or a ${otherwise}.`,
          "type",
        )
      }
      return then
    }

    case "call": {
      const fn = FUNCTIONS[node.name]
      if (!fn) {
        throw new ExpressionError(
          `"${node.name}" is not a function in this language. The set is fixed: ${Object.keys(FUNCTIONS).sort().join(", ")}.`,
          "type",
        )
      }
      const argTypes = node.args.map((a) => typeOf(a, env))
      if (fn.params === "variadic") {
        if (argTypes.length === 0) throw new ExpressionError(`"${node.name}" needs at least one argument.`, "type")
        for (const type of argTypes) {
          if (type !== fn.variadicOf) {
            throw new ExpressionError(`"${node.name}" takes ${fn.variadicOf} arguments, not a ${type}.`, "type")
          }
        }
        return fn.returns
      }
      if (argTypes.length !== fn.params.length) {
        throw new ExpressionError(
          `"${node.name}" takes ${fn.params.length} argument(s), not ${argTypes.length}.`,
          "type",
        )
      }
      fn.params.forEach((expected, index) => {
        if (argTypes[index] !== expected) {
          throw new ExpressionError(
            `"${node.name}" argument ${index + 1} must be a ${expected}, not a ${argTypes[index]}.`,
            "type",
          )
        }
      })
      return fn.returns
    }
  }
}

// ── Evaluation ───────────────────────────────────────────────────────────────

export type ValueEnv = Readonly<Record<string, unknown>>

export interface EvaluationResult {
  value: unknown
  /** Nodes visited. The cost actually incurred, for a budget or a report. */
  steps: number
}

/**
 * Evaluate a type-checked expression.
 *
 * The environment is a FLAT map keyed by dotted path, not a nested object, and
 * that is a security decision rather than a convenience: a nested lookup walks
 * properties, and walking properties on a host object is how `constructor` is
 * reached. Here a path is a string key, `Object.hasOwn` decides whether it
 * exists, and there is no traversal to subvert. Paths are refused at parse time
 * as well, so both halves would have to fail together.
 */
export function evaluate(node: Node, env: ValueEnv, limits: Limits = DEFAULT_LIMITS): EvaluationResult {
  let steps = 0

  const step = () => {
    steps++
    if (steps > limits.maxSteps) {
      throw new ExpressionError(`Evaluation exceeded ${limits.maxSteps} steps.`, "evaluate")
    }
  }

  const run = (n: Node): unknown => {
    step()
    switch (n.kind) {
      case "number":
      case "string":
      case "boolean":
        return n.value
      case "null":
        return null

      case "var": {
        const path = n.path.join(".")
        if (!Object.hasOwn(env, path)) {
          throw new ExpressionError(`"${path}" is not in the environment.`, "evaluate")
        }
        return env[path]
      }

      case "unary":
        return n.op === "-" ? -(run(n.operand) as number) : !(run(n.operand) as boolean)

      case "binary": {
        const left = run(n.left)
        const right = run(n.right)
        switch (n.op) {
          case "+":
            return typeof left === "string" ? (left as string) + (right as string) : (left as number) + (right as number)
          case "-":
            return (left as number) - (right as number)
          case "*":
            return (left as number) * (right as number)
          case "/":
          case "%": {
            if ((right as number) === 0) {
              // Infinity and NaN are not values this language has. Returning one
              // would put a non-finite number into a configuration digest and
              // make every later comparison behave in ways nobody wrote down.
              throw new ExpressionError(`Division by zero.`, "evaluate")
            }
            return n.op === "/" ? (left as number) / (right as number) : (left as number) % (right as number)
          }
          case "<":
            return (left as number) < (right as number)
          case "<=":
            return (left as number) <= (right as number)
          case ">":
            return (left as number) > (right as number)
          case ">=":
            return (left as number) >= (right as number)
          case "==":
            return left === right
          case "!=":
            return left !== right
          default:
            throw new ExpressionError(`Unknown operator "${n.op}".`, "evaluate")
        }
      }

      case "logical": {
        // Short-circuits, which is why the step count depends on the data and is
        // reported rather than assumed.
        const left = run(n.left) as boolean
        if (n.op === "&&") return left ? (run(n.right) as boolean) : false
        return left ? true : (run(n.right) as boolean)
      }

      case "conditional":
        return (run(n.test) as boolean) ? run(n.then) : run(n.otherwise)

      case "call": {
        const fn = FUNCTIONS[n.name]
        if (!fn) throw new ExpressionError(`"${n.name}" is not a function.`, "evaluate")
        const args = n.args.map(run)
        const result = fn.apply(args)
        if (typeof result === "number" && !Number.isFinite(result)) {
          throw new ExpressionError(`"${n.name}" produced a non-finite number.`, "evaluate")
        }
        return result
      }
    }
  }

  const value = run(node)
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new ExpressionError("Expression produced a non-finite number.", "evaluate")
  }
  return { value, steps }
}

/** Parse, type-check and evaluate in one call. The normal entry point. */
export function run(
  source: string,
  types: TypeEnv,
  values: ValueEnv,
  limits: Limits = DEFAULT_LIMITS,
): EvaluationResult {
  const ast = parse(source, limits)
  typeOf(ast, types)
  return evaluate(ast, values, limits)
}
