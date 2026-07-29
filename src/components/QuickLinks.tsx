import { Card } from "@/components/ui/Card"
import { resourcesForSeats, type Resource, type SeatKey } from "@/lib/resources"
import { QuickLinksRotator } from "./QuickLinksRotator"

/**
 * The handful of links a board member opens constantly, on the first page they
 * land on, personalized to the seats they hold. Kept compact: the client
 * rotator pages through them rather than listing them all at once.
 *
 * Resources are passed in rather than imported, so a resource OSE publishes
 * today reaches officers' dashboards on the next load — the previous version
 * read a hardcoded module array and could only change with a deploy.
 */
export function QuickLinks({ resources, seats }: { resources: Resource[]; seats: SeatKey[] }) {
  const links = resourcesForSeats(resources, seats)
    .filter((r) => r.ready)
    .slice(0, 12)
    .map((r) => ({ id: r.id, title: r.title, href: r.href, external: Boolean(r.external) }))
  if (links.length === 0) return null

  return (
    <Card>
      <QuickLinksRotator links={links} />
    </Card>
  )
}
