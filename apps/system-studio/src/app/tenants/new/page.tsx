import Link from "next/link"
import { redirect } from "next/navigation"

import { TENANT_BINDINGS } from "@tenure/blueprints"
import { MODULE_CATALOG } from "@tenure/modules"
import { PLAN_CATALOG } from "@tenure/provisioning"

import { auth } from "@/lib/auth"
import { isOperator } from "@/lib/operators"
import { ComposeForm } from "./ComposeForm"

export const dynamic = "force-dynamic"

/**
 * Compose a tenant.
 *
 * The form is a client component only because it needs `useActionState` to show
 * validation problems without losing what was typed. Everything it offers —
 * blueprints, modules — is read here, on the server, from the same catalogs
 * provisioning will use. A hardcoded list in the form would drift from what can
 * actually be built.
 */
export default async function NewTenantPage() {
  const session = await auth()
  if (!isOperator(session?.user?.email)) redirect("/signin")

  const blueprints = [...new Set(TENANT_BINDINGS.map((b) => b.blueprintId))]
  const modules = MODULE_CATALOG.all().map((m) => ({
    key: m.key,
    description: m.description,
    version: m.version,
  }))
  const plans = PLAN_CATALOG.map((plan) => ({
    planId: plan.planId,
    displayName: plan.displayName,
    grants:
      plan.entitlements.length > 0
        ? plan.entitlements.join(", ")
        : "blueprint modules only",
  }))

  return (
    <>

      <p className="breadcrumb">
        <Link href="/tenants">Tenants</Link> <span aria-hidden="true">/</span> Compose
      </p>

      <h1>Compose a tenant</h1>
      <p>
        This registers the tenant in <code>DRAFT</code>. Nothing is built, nothing is billed, and no
        routing changes — provisioning is a separate, approved step you take from the tenant&rsquo;s
        page once you have read its plan.
      </p>

      <ComposeForm blueprints={blueprints} modules={modules} plans={plans} />
    </>
  )
}
