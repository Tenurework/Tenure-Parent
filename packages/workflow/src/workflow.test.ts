import {
  WorkflowDefinitionError,
  WorkflowError,
  advance,
  applyAction,
  availableActions,
  isTerminal,
  publishDefinition,
  startInstance,
  validateDefinition,
  type WorkflowDefinition,
} from "./index"

const TWO_GATE: WorkflowDefinition = publishDefinition({
  key: "twoGate",
  version: "1.0.0",
  name: "Two-gate review",
  initial: "DRAFT",
  states: [
    { key: "DRAFT", label: "Draft" },
    { key: "GATE_1", label: "Gate one" },
    { key: "GATE_2", label: "Gate two" },
    { key: "DONE", label: "Done", terminal: true },
    { key: "STOPPED", label: "Stopped", terminal: true },
  ],
  transitions: [
    { action: "submit", from: "DRAFT", to: "GATE_1", allowedRoles: ["author"], label: "Submit" },
    { action: "approve", from: "GATE_1", to: "GATE_2", allowedRoles: ["reviewer"], label: "Approve" },
    { action: "approve", from: "GATE_2", to: "DONE", allowedRoles: ["director"], label: "Approve" },
    { action: "stop", from: "GATE_1", to: "STOPPED", allowedRoles: ["reviewer", "director"], label: "Stop" },
    { action: "stop", from: "GATE_2", to: "STOPPED", allowedRoles: ["director"], label: "Stop" },
  ],
})

const AT = "2026-07-31T12:00:00Z"

describe("a definition is checked before anything runs on it", () => {
  const base = {
    key: "k",
    version: "1.0.0",
    name: "n",
    initial: "A",
    states: [{ key: "A", label: "A" }, { key: "B", label: "B", terminal: true }],
    transitions: [{ action: "go", from: "A", to: "B", allowedRoles: ["x"], label: "Go" }],
  }

  it("accepts a well-formed one", () => {
    expect(() => validateDefinition(base)).not.toThrow()
  })

  it("refuses a non-terminal state with no way out", () => {
    // An instance that reaches it can never leave, which looks to the person
    // holding it exactly like a permissions problem.
    expect(() =>
      validateDefinition({
        ...base,
        states: [...base.states, { key: "C", label: "C" }],
        transitions: [...base.transitions, { action: "go2", from: "A", to: "C", allowedRoles: ["x"], label: "Go2" }],
      }),
    ).toThrow(/not terminal and has no outgoing transition/)
  })

  it("refuses an unreachable state", () => {
    expect(() =>
      validateDefinition({
        ...base,
        states: [...base.states, { key: "Z", label: "Z", terminal: true }],
      }),
    ).toThrow(/unreachable from the initial state/)
  })

  it("refuses a transition leaving a terminal state", () => {
    expect(() =>
      validateDefinition({
        ...base,
        transitions: [...base.transitions, { action: "undo", from: "B", to: "A", allowedRoles: ["x"], label: "Undo" }],
      }),
    ).toThrow(/leaves terminal state/)
  })

  it("refuses a transition nobody can take", () => {
    expect(() =>
      validateDefinition({ ...base, transitions: [{ ...base.transitions[0], allowedRoles: [] }] }),
    ).toThrow(/allows no roles, so nobody could take it/)
  })

  it("refuses two identical transitions, where order would decide the outcome", () => {
    expect(() =>
      validateDefinition({
        ...base,
        states: [...base.states, { key: "C", label: "C", terminal: true }],
        transitions: [
          ...base.transitions,
          { action: "go", from: "A", to: "C", allowedRoles: ["x"], label: "Go elsewhere" },
        ],
      }),
    ).toThrow(/Two transitions for "go" from "A" with the same condition/)
  })

  it("refuses an initial state it does not declare", () => {
    expect(() => validateDefinition({ ...base, initial: "NOPE" })).toThrow(/is not declared/)
  })

  it("refuses when and unless on one transition", () => {
    expect(() =>
      validateDefinition({
        ...base,
        transitions: [{ ...base.transitions[0], when: "a", unless: "b" }],
      }),
    ).toThrow(WorkflowDefinitionError)
  })

  it("freezes what it publishes", () => {
    expect(Object.isFrozen(TWO_GATE)).toBe(true)
    expect(Object.isFrozen(TWO_GATE.transitions)).toBe(true)
  })
})

describe("available actions depend on state and on the actor's roles", () => {
  it("offers the author submit, and nobody else", () => {
    expect(
      availableActions(TWO_GATE, { state: "DRAFT", roles: ["author"] }).map((a) => a.action),
    ).toEqual(["submit"])
    expect(availableActions(TWO_GATE, { state: "DRAFT", roles: ["director"] })).toEqual([])
  })

  it("offers different things at each gate", () => {
    expect(
      availableActions(TWO_GATE, { state: "GATE_1", roles: ["reviewer"] }).map((a) => a.action),
    ).toEqual(["approve", "stop"])
    // A reviewer has no authority at the second gate.
    expect(availableActions(TWO_GATE, { state: "GATE_2", roles: ["reviewer"] })).toEqual([])
    expect(
      availableActions(TWO_GATE, { state: "GATE_2", roles: ["director"] }).map((a) => a.action),
    ).toEqual(["approve", "stop"])
  })

  it("offers nothing in a terminal state", () => {
    expect(availableActions(TWO_GATE, { state: "DONE", roles: ["director"] })).toEqual([])
    expect(isTerminal(TWO_GATE, "DONE")).toBe(true)
    expect(isTerminal(TWO_GATE, "GATE_1")).toBe(false)
  })

  it("returns each action once even when several transitions offer it", () => {
    const both = availableActions(TWO_GATE, { state: "GATE_1", roles: ["reviewer", "director"] })
    expect(both.filter((a) => a.action === "stop")).toHaveLength(1)
  })
})

describe("refusals are distinguished, because they need different responses", () => {
  it("separates stale state from genuine denial from a typo", () => {
    expect(applyAction(TWO_GATE, { state: "DONE", roles: ["director"] }, "approve")).toMatchObject({
      reason: "not-from-this-state",
    })
    expect(applyAction(TWO_GATE, { state: "GATE_2", roles: ["reviewer"] }, "approve")).toMatchObject({
      reason: "actor-not-permitted",
    })
    expect(applyAction(TWO_GATE, { state: "DRAFT", roles: ["author"] }, "teleport")).toMatchObject({
      reason: "unknown-action",
    })
  })

  it("names a condition that was not met", () => {
    const conditional = publishDefinition({
      key: "c",
      version: "1.0.0",
      name: "c",
      initial: "A",
      states: [{ key: "A", label: "A" }, { key: "B", label: "B", terminal: true }],
      transitions: [{ action: "go", from: "A", to: "B", when: "ready", allowedRoles: ["x"], label: "Go" }],
    })
    const r = applyAction(conditional, { state: "A", roles: ["x"], conditions: { ready: false } }, "go")
    expect(r).toMatchObject({ reason: "condition-not-met" })
    expect(r.ok === false && r.detail).toContain("ready=true")
  })
})

describe("an instance is pinned to the version it started under", () => {
  it("records history without mutating", () => {
    const i0 = startInstance(TWO_GATE, "req-1")
    const i1 = advance(TWO_GATE, i0, { roles: ["author"] }, "submit", { actor: "u1", at: AT })
    const i2 = advance(TWO_GATE, i1, { roles: ["reviewer"] }, "approve", { actor: "u2", at: AT })

    expect(i0.state).toBe("DRAFT")
    expect(i1.state).toBe("GATE_1")
    expect(i2.state).toBe("GATE_2")
    expect(i2.history.map((h) => `${h.from}->${h.to}`)).toEqual(["DRAFT->GATE_1", "GATE_1->GATE_2"])
    expect(i2.history[1].actor).toBe("u2")
  })

  it("refuses to run against a different version of its definition", () => {
    // Publishing a new flow must not change what the fifty requests already in
    // flight are allowed to do. An approver who opened a request under one set
    // of gates should not find a different set on returning to it.
    const i0 = startInstance(TWO_GATE, "req-1")
    const v2 = publishDefinition({ ...TWO_GATE, version: "2.0.0" })
    expect(() => advance(v2, i0, { roles: ["author"] }, "submit", { actor: "u", at: AT })).toThrow(
      /pinned to twoGate@1\.0\.0/,
    )
  })

  it("throws a typed error carrying the refusal reason", () => {
    const i0 = startInstance(TWO_GATE, "req-1")
    try {
      advance(TWO_GATE, i0, { roles: ["reviewer"] }, "submit", { actor: "u", at: AT })
      throw new Error("expected a throw")
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowError)
      expect((err as WorkflowError).reason).toBe("actor-not-permitted")
    }
  })
})

describe("one engine, two different flows", () => {
  it("runs a single-gate flow with no code change", () => {
    // The point of the whole package: a different organization system gets a
    // different definition, not a different engine.
    const oneGate = publishDefinition({
      key: "oneGate",
      version: "1.0.0",
      name: "Coordinator sign-off",
      initial: "DRAFT",
      states: [
        { key: "DRAFT", label: "Draft" },
        { key: "PENDING", label: "Pending" },
        { key: "DONE", label: "Done", terminal: true },
      ],
      transitions: [
        { action: "submit", from: "DRAFT", to: "PENDING", allowedRoles: ["author"], label: "Submit" },
        { action: "approve", from: "PENDING", to: "DONE", allowedRoles: ["coordinator"], label: "Approve" },
      ],
    })

    const done = advance(
      oneGate,
      advance(oneGate, startInstance(oneGate, "p-1"), { roles: ["author"] }, "submit", { actor: "a", at: AT }),
      { roles: ["coordinator"] },
      "approve",
      { actor: "c", at: AT },
    )
    expect(done.state).toBe("DONE")
    expect(done.history).toHaveLength(2)
  })
})
