import { chromium } from "@playwright/test"
const BASE = process.env.PLAYWRIGHT_BASE_URL
const OP = (process.env.PLATFORM_OPERATORS ?? "").split(",")[0].split(":")[0]
const SECRET = process.env.PLATFORM_OPERATOR_SECRET
const b = await chromium.launch()
const p = await b.newPage()
await p.goto(BASE + "/signin", { timeout: 120000 })
await p.getByLabel("Email").fill(OP)
await p.getByLabel("Operator secret").fill(SECRET)
await p.getByRole("button", { name: "Sign in" }).click()
await p.waitForLoadState("networkidle")
for (const r of ["/", "/tenants", "/tenants/new", "/platform", "/platform/cost", "/platform/audit", "/platform/estate", "/platform/health", "/platform/security"]) {
  const t0 = Date.now()
  await p.goto(BASE + r, { timeout: 180000 })
  await p.waitForLoadState("networkidle")
  console.log(r, Date.now() - t0, "ms")
}
await b.close()
