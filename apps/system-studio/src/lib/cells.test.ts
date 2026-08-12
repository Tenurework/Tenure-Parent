import { __resetEstate, primeEstate } from "./cells"
import { resolveIdentity } from "./aws/identity"

jest.mock("./aws/identity", () => ({
  resolveIdentity: jest.fn(async () => {
    throw new Error("sts:GetCallerIdentity should not be called when the estate is explicit")
  }),
}))

describe("priming the cell estate", () => {
  const env = { ...process.env }

  afterEach(() => {
    process.env = { ...env }
    jest.clearAllMocks()
    __resetEstate()
  })

  it("does not call STS when region, account and partition are explicit", async () => {
    process.env.AWS_REGION = "us-east-1"
    process.env.AWS_ACCOUNT_ID = "123456789012"
    process.env.AWS_PARTITION = "aws"

    await expect(primeEstate()).resolves.toBeUndefined()

    expect(resolveIdentity).not.toHaveBeenCalled()
  })
})
