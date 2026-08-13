import { chromium } from "@playwright/test"

const BASE = process.env.PLAYWRIGHT_BASE_URL
const OP = (process.env.PLATFORM_OPERATORS ?? "").split(",")[0].split(":")[0]
const SECRET = process.env.PLATFORM_OPERATOR_SECRET
const ROUTES = process.argv.slice(2).map((r) => (r.startsWith("/") ? r : "/" + r))

const b = await chromium.launch()
const p = await b.newPage()
let t0 = Date.now()
await p.goto(BASE + "/signin", { timeout: 300000 })
console.log("/signin", Date.now() - t0, "ms")
await p.getByLabel("Email").fill(OP)
await p.getByLabel("Operator secret").fill(SECRET)
await p.getByRole("button", { name: "Sign in" }).click()
await p.waitForLoadState("networkidle")
for (const r of ROUTES) {
  t0 = Date.now()
  await p.goto(BASE + r, { timeout: 300000 })
  await p.waitForLoadState("networkidle")
  const h1 = await p.locator("h1").first().innerText().catch(() => "(none)")
  console.log(r, Date.now() - t0, "ms", "url=", p.url(), "h1=", JSON.stringify(h1))
}
await b.close()
