import { redirect } from "next/navigation"

export default async function OrgPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(`/orgs/${slug}/members`)
}
