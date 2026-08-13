import { test } from "@playwright/test"
import { operatorFor } from "./operator-identity"

test("dump health", async ({ page }) => {
  await page.goto("/signin")
  console.log("OPERATOR:", JSON.stringify(operatorFor()), "SECRET LEN:", (process.env.PLATFORM_OPERATOR_SECRET ?? "").length)
  await page.getByLabel("Email").fill(operatorFor())
  await page.getByLabel("Operator secret").fill(process.env.PLATFORM_OPERATOR_SECRET ?? "")
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForLoadState("networkidle")
  console.log("AFTER SIGNIN URL:", page.url())
  console.log("COOKIES:", (await page.context().cookies()).map((c) => c.name).join(","))
  await page.goto("/platform/health")
  await page.waitForLoadState("networkidle")
  console.log("HEALTH URL:", page.url())
  console.log(await page.locator("body").first().innerText())
})
