import { test, expect } from "@playwright/test"
import { authenticateOperator, isOperator, secretMatches, operatorConfigProblems } from "../src/lib/operators"

test("credentials in this env are accepted", () => {
  const email = "studio.operator@tenure.example"
  const secret = process.env.PLATFORM_OPERATOR_SECRET ?? ""
  console.log("problems:", JSON.stringify(operatorConfigProblems(process.env, { requireSharedSecret: true })))
  console.log("isOperator:", isOperator(email), "secretMatches:", secretMatches(secret))
  expect(authenticateOperator(email, secret)).toBe(true)
})
