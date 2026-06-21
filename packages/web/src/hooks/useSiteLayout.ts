import { useQuery } from '@tanstack/react-query'
import type { SiteLayout } from '@net3d/shared'

/**
 * Custom floor-plan layouts are backend-agnostic: a site's physical footprint is
 * the same whether the data comes from NetBox or Infrahub. They are therefore
 * keyed by site name and ALWAYS served via the `/api` prefix (NOT apiUrl(backend)),
 * so in the dual-backend deploy only the NetBox app instance stores them — no
 * shared volume and no second nginx write carve-out needed.
 */
const layoutUrl = (site: string): string => `/api/layouts/${encodeURIComponent(site)}`

/** Fetch the saved layout for a site; null when none has been saved (404). */
export function useSiteLayoutQuery(siteName: string | null) {
  return useQuery<SiteLayout | null>({
    queryKey: ['layout', siteName],
    queryFn: async () => {
      const res = await fetch(layoutUrl(siteName!))
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`layout ${siteName}: HTTP ${res.status}`)
      return res.json()
    },
    enabled: !!siteName,
    staleTime: 60_000,
  })
}
