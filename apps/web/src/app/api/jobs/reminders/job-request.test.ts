/**
 * PACK-010-001 — the reminder sweep runs against a validated `JobRequest`.
 *
 * `JobRequest`'s own doc comment names this job as the reason `tenantId` is
 * nullable, and until now the two had never met: the route ignored its body
 * entirely, so a scheduler could ask for a ninth attempt of a three-attempt job
 * and get a full sweep — mailing deadline reminders — with nothing to say it
 * had happened before.
 *
 * The bearer token authenticates the caller. It says nothing about the numbers
 * the caller sends, which is exactly the boundary a runtime contract is for.
 *
 * Everything below the route is faked because the sweep itself is proven
 * against a real database by `lib/jobs/reminders-isolation.itest.ts`. What is
 * under test here is the envelope, and specifically whether an envelope the
 * contract refuses can reach the sweep at all.
 */
// The globals, deliberately not `import { jest } from "@jest/globals"`. Under
// that import the `jest.mock` calls below are not hoisted above the `import`
// of the route, so the route binds the real `@/lib/tenant-scope` and the sweep
// reaches for a database. The two tests that exercise the success path failed
// exactly that way before this comment existed.
const forEach = jest.fn(async () => [] as unknown[])

jest.mock("@/lib/tenant-scope", () => ({
  forEachInstitution: (...args: unknown[]) => forEach(...(args as [])),
}))

jest.mock("@/lib/db", () => ({ db: {} }))
jest.mock("@/lib/notify", () => ({ notifyUsers: async () => {} }))
jest.mock("@/lib/resources", () => ({ seatKeysForRole: () => [] }))

import { POST } from "./route"

const SECRET = "job-secret-for-this-test"

function request(body: unknown) {
  return new Request("http://localhost/api/jobs/reminders", {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  process.env.JOB_SECRET = SECRET
  // Implementation re-set, not merely cleared: the sweep is not what is under
  // test here, and a pass that reached a real database would be reporting on
  // the harness rather than on the envelope.
  forEach.mockReset()
  forEach.mockImplementation(async () => [])
})

describe("the reminder sweep's job envelope", () => {
  it("runs, and reports the identity it ran under, when none was supplied", () => {
    // A scheduler that sends nothing still gets a job id back, because a
    // support question about a duplicate notification has nothing else to join
    // on. The idempotency key names the hour window the run covers, so two
    // invocations of the same schedule carry the same one.
    return POST(request({}))
      .then((res) => res.json())
      .then((body) => {
        expect(typeof body.jobId).toBe("string")
        expect(body.attempt).toBe(1)
        expect(body.idempotencyKey).toMatch(/^deliverable-reminders:\d{4}-\d{2}-\d{2}T\d{2}$/)
        expect(forEach).toHaveBeenCalledTimes(1)
      })
  })

  it("keeps the scheduler's own identity when it sends one", async () => {
    const body = await (
      await POST(request({ jobId: "sched-42", attempt: 2, maxAttempts: 3 }))
    ).json()

    expect(body.jobId).toBe("sched-42")
    expect(body.attempt).toBe(2)
  })

  it("refuses an attempt beyond the job's own limit, without sweeping", async () => {
    // The assertion this whole item exists for: a job that should already be
    // dead does not re-send a round of deadline reminders.
    const res = await POST(request({ jobId: "sched-42", attempt: 9, maxAttempts: 3 }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("invalid_job_request")
    expect(body.detail).toMatch(/already be dead/)
    expect(forEach).not.toHaveBeenCalled()
  })

  it("refuses a malformed envelope rather than substituting a default for it", async () => {
    const res = await POST(request({ attempt: 0 }))

    expect(res.status).toBe(400)
    expect((await res.json()).detail).toMatch(/JobRequest\.attempt/)
    expect(forEach).not.toHaveBeenCalled()
  })

  it("still refuses an unauthenticated caller before reading the body at all", async () => {
    const res = await POST(
      new Request("http://localhost/api/jobs/reminders", { method: "POST", body: "not json" }),
    )
    expect(res.status).toBe(401)
    expect(forEach).not.toHaveBeenCalled()
  })
})
