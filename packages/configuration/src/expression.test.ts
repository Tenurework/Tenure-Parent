import {
  DEFAULT_LIMITS,
  EXPRESSION_LANGUAGE_VERSION,
  ExpressionError,
  dependencies,
  evaluate,
  expressionCycles,
  parse,
  run,
  typeOf,
  type TypeEnv,
  type ValueEnv,
} from "./expression"

/**
 * GE-031-005 — the expression language.
 *
 * The tests that matter are the refusals. An expression engine that evaluates
 * arithmetic is easy; one that cannot be talked into reaching `process` is the
 * whole requirement, and the escapes below are the real ones — they work
 * against `eval`, against `new Function`, and against most hand-rolled
 * "sandboxes".
 */

const TYPES: TypeEnv = {
  "tenant.seats": "number",
  "tenant.name": "string",
  "tenant.active": "boolean",
  "plan.limit": "number",
}
const VALUES: ValueEnv = {
  "tenant.seats": 12,
  "tenant.name": "Simon",
  "tenant.active": true,
  "plan.limit": 20,
}

const evalIt = (source: string) => run(source, TYPES, VALUES).value

describe("it computes what it says", () => {
  it("does arithmetic with the usual precedence", () => {
    expect(evalIt("1 + 2 * 3")).toBe(7)
    expect(evalIt("(1 + 2) * 3")).toBe(9)
    expect(evalIt("-4 + 10")).toBe(6)
  })

  it("reads declared variables by dotted path", () => {
    expect(evalIt("tenant.seats + 1")).toBe(13)
    expect(evalIt("tenant.name")).toBe("Simon")
  })

  it("compares, combines and branches", () => {
    expect(evalIt("tenant.seats < plan.limit")).toBe(true)
    expect(evalIt("tenant.active && tenant.seats > 100")).toBe(false)
    expect(evalIt("tenant.seats > 100 ? 1 : 2")).toBe(2)
  })

  it("has a fixed set of pure functions", () => {
    expect(evalIt("min(3, 1, 2)")).toBe(1)
    expect(evalIt("upper(tenant.name)")).toBe("SIMON")
    expect(evalIt('contains(tenant.name, "im")')).toBe(true)
    expect(evalIt("len(tenant.name)")).toBe(5)
  })

  it("concatenates strings only when both sides are strings", () => {
    expect(evalIt('tenant.name + " OSE"')).toBe("Simon OSE")
    expect(() => evalIt('tenant.name + 1')).toThrow(/needs numbers/)
  })
})

describe("reflection is not reachable, by any of the routes that work elsewhere", () => {
  // Each of these is a real escape against eval, new Function, or a sandbox
  // that hands over host objects. None of them survives a closed AST with a
  // flat environment, and each is refused at PARSE time so an attempt is
  // visible in review rather than merely inert.

  it("refuses the constructor walk that reaches Function", () => {
    // ({}).constructor.constructor("return process")() — the canonical one.
    expect(() => parse("a.constructor.constructor")).toThrow(/Reflection is not part of this language/)
  })

  it("refuses __proto__ and prototype", () => {
    expect(() => parse("a.__proto__")).toThrow(ExpressionError)
    expect(() => parse("a.prototype.x")).toThrow(ExpressionError)
  })

  it("refuses the host names outright", () => {
    for (const name of ["process", "globalThis", "require", "module", "eval", "Function"]) {
      expect(() => parse(`${name}.x`)).toThrow(/Reflection is not part of this language/)
    }
  })

  it("cannot call anything outside the fixed function set", () => {
    expect(() => run("fetch(1)", TYPES, VALUES)).toThrow(/is not a function in this language/)
    expect(() => run("setTimeout(1)", TYPES, VALUES)).toThrow(/is not a function in this language/)
  })

  it("cannot read a name nobody declared, even one that exists in the values", () => {
    // The type environment is the gate, and it is separate from the values on
    // purpose: a value present by accident must not become reachable.
    expect(() => run("secret", { ...TYPES }, { ...VALUES, secret: "s3cret" })).toThrow(/is not declared/)
  })

  it("cannot reach a property of a value, because paths are flat keys", () => {
    // `tenant.name` is one key, not an object walk. There is no traversal to
    // subvert — `Object.hasOwn` decides, and inherited properties are invisible.
    expect(() => run("tenant.name.length", { ...TYPES, "tenant.name.length": "number" }, VALUES)).toThrow(
      /not in the environment/,
    )
  })

  it("has no string escape that hides what a reviewer reads", () => {
    // \u and \x let a review see one string and the parser see another.
    expect(() => parse('"\\u0041"')).toThrow(/Unsupported escape/)
    expect(() => parse('"\\x41"')).toThrow(/Unsupported escape/)
    expect(evalIt('"a\\nb"')).toBe("a\nb")
  })
})

describe("it is bounded in four dimensions", () => {
  it("refuses a source longer than the limit", () => {
    expect(() => parse("1" + " + 1".repeat(10_000))).toThrow(/characters; the limit is/)
  })

  it("refuses too many tokens", () => {
    // Short enough to pass the length gate, long enough to fail the token one.
    expect(() => parse("1" + "+1".repeat(300), { ...DEFAULT_LIMITS, maxLength: 100_000 })).toThrow(
      /more than 400 tokens/,
    )
  })

  it("refuses nesting deeper than the limit, before the host stack is at risk", () => {
    // A step counter cannot catch this: the failure would be during PARSING,
    // and a RangeError from a blown stack is not a rejected configuration.
    const deep = "(".repeat(200) + "1" + ")".repeat(200)
    expect(() => parse(deep, { ...DEFAULT_LIMITS, maxTokens: 100_000 })).toThrow(/nests deeper than/)
  })

  it("refuses an evaluation that costs more than its budget", () => {
    const ast = parse("1+1+1+1+1+1+1+1+1+1")
    expect(() => evaluate(ast, {}, { ...DEFAULT_LIMITS, maxSteps: 5 })).toThrow(/exceeded 5 steps/)
  })

  it("reports the cost actually incurred", () => {
    // Short-circuiting makes cost depend on the data, so it is measured rather
    // than assumed — a budget needs the real number.
    const long = evaluate(parse("tenant.active && tenant.seats > 1"), VALUES)
    const short = evaluate(parse("!tenant.active && tenant.seats > 1"), VALUES)
    expect(short.steps).toBeLessThan(long.steps)
  })
})

describe("it is deterministic", () => {
  it("has no clock and no randomness to call", () => {
    for (const name of ["now", "random", "uuid", "today"]) {
      expect(() => run(`${name}()`, TYPES, VALUES)).toThrow(/is not a function in this language/)
    }
  })

  it("gives the same answer every time for the same inputs", () => {
    const source = 'min(tenant.seats, plan.limit) + len(upper(tenant.name))'
    const first = run(source, TYPES, VALUES).value
    for (let i = 0; i < 20; i++) expect(run(source, TYPES, VALUES).value).toBe(first)
  })

  it("does not depend on the order keys were declared in", () => {
    const reversed = Object.fromEntries(Object.entries(VALUES).reverse())
    expect(run("tenant.seats + plan.limit", TYPES, reversed).value).toBe(
      run("tenant.seats + plan.limit", TYPES, VALUES).value,
    )
  })

  it("rounds halves away from zero, stated rather than inherited", () => {
    // Math.round sends -0.5 to -0, so "round" agreeing between two engines is
    // not something to assume.
    expect(evalIt("round(0 - 0.5)")).toBe(-1)
    expect(evalIt("round(0.5)")).toBe(1)
  })

  it("refuses to produce a non-finite number", () => {
    // Infinity in a configuration digest makes every later comparison behave in
    // ways nobody wrote down.
    expect(() => evalIt("1 / 0")).toThrow(/Division by zero/)
    expect(() => evalIt("1 % 0")).toThrow(/Division by zero/)
    expect(() => parse("1e400")).toThrow()
  })
})

describe("types are checked before anything runs", () => {
  it("catches a mismatch statically", () => {
    // The branch that reaches it might be taken once a year. Publication is the
    // right time to find out.
    expect(() => run("1 + true", TYPES, VALUES)).toThrow(/needs numbers/)
    expect(() => run("!tenant.seats", TYPES, VALUES)).toThrow(/Cannot apply "!" to a number/)
  })

  it("refuses comparing different types rather than always answering false", () => {
    expect(() => run('tenant.seats == tenant.name', TYPES, VALUES)).toThrow(/Cannot compare a number with a string/)
  })

  it("has no truthiness", () => {
    // `"" || "fallback"` reads as a default and would depend on coercion rules a
    // tenant author has no reason to know.
    expect(() => run('tenant.name && tenant.active', TYPES, VALUES)).toThrow(/needs booleans/)
  })

  it("requires both branches of a conditional to agree", () => {
    expect(() => run('tenant.active ? 1 : "two"', TYPES, VALUES)).toThrow(/Both branches must have one type/)
  })

  it("checks arity and argument types of functions", () => {
    expect(() => run("abs(1, 2)", TYPES, VALUES)).toThrow(/takes 1 argument/)
    expect(() => run("upper(tenant.seats)", TYPES, VALUES)).toThrow(/must be a string/)
    expect(() => run("min()", TYPES, VALUES)).toThrow(/at least one argument/)
  })

  it("reports the type of a valid expression", () => {
    expect(typeOf(parse("tenant.seats > 1"), TYPES)).toBe("boolean")
    expect(typeOf(parse('tenant.name + "!"'), TYPES)).toBe("string")
  })
})

describe("dependency analysis", () => {
  it("lists every path an expression reads, sorted and de-duplicated", () => {
    expect(dependencies(parse("tenant.seats + tenant.seats + plan.limit"))).toEqual([
      "plan.limit",
      "tenant.seats",
    ])
  })

  it("looks inside every branch, including the one not taken", () => {
    // A dependency that only appears in the false branch is still a dependency;
    // missing it would let a cycle through.
    expect(dependencies(parse("tenant.active ? plan.limit : tenant.seats"))).toEqual([
      "plan.limit",
      "tenant.active",
      "tenant.seats",
    ])
  })

  it("looks inside function arguments", () => {
    expect(dependencies(parse("max(tenant.seats, plan.limit)"))).toEqual(["plan.limit", "tenant.seats"])
  })
})

describe("cycle detection among named expressions", () => {
  it("finds a two-expression cycle", () => {
    // Evaluating this recurses until the host stack gives out — a crash in a
    // request handler rather than a rejected configuration.
    expect(expressionCycles({ a: "b + 1", b: "a + 1" })).toEqual(["a → b → a"])
  })

  it("finds a longer cycle and reports it once", () => {
    const cycles = expressionCycles({ a: "b + 1", b: "c + 1", c: "a + 1" })
    expect(cycles).toHaveLength(1)
    expect(cycles[0]).toMatch(/a → b → c → a/)
  })

  it("finds a self-reference", () => {
    expect(expressionCycles({ a: "a + 1" })).toEqual(["a → a"])
  })

  it("is quiet when the graph is acyclic", () => {
    expect(expressionCycles({ a: "b + 1", b: "c + 1", c: "1" })).toEqual([])
  })

  it("does not mistake a shared dependency for a cycle", () => {
    // a and b both read c. Two paths to one node is a diamond, not a cycle.
    expect(expressionCycles({ a: "c + 1", b: "c + 2", c: "1" })).toEqual([])
  })

  it("ignores references to plain data, which terminate", () => {
    expect(expressionCycles({ a: "tenant.seats + 1" })).toEqual([])
  })
})

describe("the language is versioned", () => {
  it("declares a version, so a stored expression can be re-evaluated deliberately", () => {
    // An expression evaluated by a different language version is a different
    // expression; the version is what lets that be noticed.
    expect(EXPRESSION_LANGUAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
