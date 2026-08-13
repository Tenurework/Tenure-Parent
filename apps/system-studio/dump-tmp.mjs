import { chromium } from "@playwright/test"
const BASE = process.env.PLAYWRIGHT_BASE_URL
const OP = (process.env.PLATFORM_OPERATORS ?? "").split(",")[0].split(":")[0]
const SECRET = process.env.PLATFORM_OPERATOR_SECRET
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } })
p.setDefaultTimeout(180000)
p.setDefaultNavigationTimeout(180000)
p.on("response", (r) => { if (r.request().method() === "POST") console.log("POST", r.url(), r.status()) })
await p.goto(BASE + "/signin")
await p.waitForLoadState("networkidle")
await p.getByLabel("Email").fill(OP)
await p.getByLabel("Operator secret").fill(SECRET)
await Promise.all([
  p.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 180000 }).catch((e) => console.log("waitURL:", e.message.slice(0, 120))),
  p.getByRole("button", { name: "Sign in" }).click(),
])
console.log("after signin url:", p.url())
await p.goto(BASE + "/platform/estate")
await p.waitForLoadState("networkidle")
console.log("URL:", p.url())
console.log(await p.locator("body").innerText())
console.log("---- NODES:", await p.evaluate(() => document.querySelectorAll("*").length))
await b.close()
