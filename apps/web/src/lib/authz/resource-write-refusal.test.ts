import { resourceWriteRefusal } from "./resource-write-refusal";

/**
 * GE-051-005 — a refusal the reader can act on.
 */

const OFFICE = "the Office of Student Engagement";

describe("what the board says when it refuses", () => {
  it("says nothing when the decision allows", () => {
    expect(
      resourceWriteRefusal(
        { allowed: true, reason: "ALLOWED", detail: "" },
        OFFICE,
        "publish",
      ),
    ).toBeNull();
  });

  it("names the office when the answer is the wrong role", () => {
    // Names the office rather than the permission, because that is what the
    // reader can do something about.
    const message = resourceWriteRefusal(
      {
        allowed: false,
        reason: "NO_ROLE_GRANTING",
        detail: "no role confers it",
      },
      OFFICE,
      "publish",
    );
    expect(message).toBe(`Only ${OFFICE} can publish board resources.`);
  });

  it("uses the verb it was given", () => {
    for (const verb of ["publish", "edit", "retire"]) {
      expect(
        resourceWriteRefusal(
          { allowed: false, reason: "NO_ROLE_GRANTING", detail: "" },
          OFFICE,
          verb,
        ),
      ).toContain(`can ${verb} board`);
    }
  });

  it("does not blame the reader's role when the module is off", () => {
    // The case the old boolean could not express. No role would fix this, so a
    // message about roles sends somebody to ask for access they already have.
    const detail =
      '"resources.resource.create" belongs to module "resources", which this system does not run.';
    const message = resourceWriteRefusal(
      { allowed: false, reason: "MODULE_NOT_ENABLED", detail },
      OFFICE,
      "publish",
    );
    expect(message).toBe(detail);
    expect(message).not.toContain(OFFICE);
  });

  it("falls back to the office for every other denial", () => {
    // A reason nobody anticipated still gets an actionable sentence rather than
    // an engine's internals.
    for (const reason of [
      "OUT_OF_SCOPE",
      "MEMBERSHIP_NOT_ACTIVE",
      "POLICY_DENIED",
    ] as const) {
      const message = resourceWriteRefusal(
        { allowed: false, reason, detail: "internals" },
        OFFICE,
        "edit",
      );
      expect(message).toContain(OFFICE);
      expect(message).not.toContain("internals");
    }
  });
});
