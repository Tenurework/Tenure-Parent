import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

const auth = fs.readFileSync("apps/system-studio/src/lib/auth.ts", "utf8")
const signin = fs.readFileSync("apps/system-studio/src/app/signin/page.tsx", "utf8")
const ecs = fs.readFileSync("infrastructure/studio/ecs.tf", "utf8")
const cognito = fs.readFileSync("infrastructure/studio/cognito.tf", "utf8")
const deploy = fs.readFileSync(".github/workflows/deploy-studio.yml", "utf8")
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8")

test("the production Studio auth provider is Cognito", () => {
  assert.match(auth, /next-auth\/providers\/cognito/)
  assert.match(auth, /Cognito\(/)
  assert.match(signin, /Continue with Cognito/)
})

test("the Studio stack owns and wires Cognito", () => {
  for (const resource of [
    'resource "aws_cognito_user_pool" "studio"',
    'resource "aws_cognito_user_pool_client" "studio"',
    'resource "aws_cognito_user_pool_domain" "studio"',
  ]) {
    assert.ok(cognito.includes(resource), `missing ${resource}`)
  }

  for (const name of ["STUDIO_AUTH_MODE", "COGNITO_CLIENT_ID", "COGNITO_ISSUER"]) {
    assert.match(ecs, new RegExp(`name = "${name}"`), `ECS does not set ${name}`)
  }
  assert.match(ecs, /value = "cognito"/, "ECS must force production into Cognito mode")
  assert.match(ecs, /COGNITO_CLIENT_SECRET/, "ECS must receive the Cognito app client secret")
})

test("production deploy does not select the credentials harness", () => {
  assert.ok(
    !/STUDIO_AUTH_MODE[^\n]*credentials/.test(deploy),
    "deploy-studio must not enable the credentials provider in production",
  )
})

test("only CI selects the credentials harness", () => {
  assert.match(ci, /STUDIO_AUTH_MODE:\s*credentials/)
})
