import { STATIC_DESTINATIONS, tenantDestination, type Destination } from "@/lib/commands"
import { listFleet, registryConfigured } from "@/lib/registry"
import { CommandPalette } from "@/components/CommandPalette"

/**
 * GE-022-007 — supplies the launcher with real destinations.
 *
 * A server component, so the tenant list comes from the registry rather than a
 * second client fetch that would need its own auth, its own error state and its
 * own loading state.
 *
 * A registry failure degrades to the fixed destinations and says nothing. That
 * is a deliberate exception to this repository's fail-closed habit and it is
 * narrow: the launcher is a shortcut to pages that all remain reachable by
 * clicking. Taking the whole shell down because a convenience could not load
 * its optional half would be the wrong trade — and the pages themselves already
 * render an honest `ErrorState` when the same read fails there (GE-022-006).
 */
export async function Launcher() {
  let tenants: Destination[] = []
  if (registryConfigured()) {
    try {
      tenants = (await listFleet()).map((t) => tenantDestination(t.slug, t.displayName))
    } catch {
      tenants = []
    }
  }
  return <CommandPalette destinations={[...STATIC_DESTINATIONS, ...tenants]} />
}
