import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

/** What this deployment allows: open the editor (canEdit) and/or persist (canSave). */
export interface LayoutCapability {
  /** Editor UI is available (full-edit OR sandbox/preview). */
  canEdit: boolean
  /** Changes can be persisted to the server (full-edit only). */
  canSave: boolean
}

/**
 * Layout capability for this deployment. Read from the NetBox-side /api/meta (the
 * instance that stores layouts), NOT the active-backend prefix — so it reflects
 * the real write capability regardless of which backend is shown. `layoutPreview`
 * opens the editor as a local sandbox (drag/rotate/rooms) with saving disabled.
 */
export function useLayoutCapability(): LayoutCapability {
  const { data } = useQuery({
    queryKey: ['layoutCapability'],
    queryFn: async () => {
      const res = await fetch('/api/meta')
      if (!res.ok) return { canEdit: false, canSave: false }
      const meta = (await res.json()) as { layoutEditable?: boolean; layoutPreview?: boolean }
      return {
        canEdit: !!meta.layoutEditable || !!meta.layoutPreview,
        canSave: !!meta.layoutEditable,
      }
    },
    staleTime: Infinity,
  })
  return data ?? { canEdit: false, canSave: false }
}

/** Persist a site's layout (PUT). Invalidates the cached layout so the scene re-applies it. */
export function useSaveLayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      siteName,
      layout,
    }: {
      siteName: string
      layout: Pick<SiteLayout, 'racks' | 'rooms' | 'floor'>
    }) => {
      const res = await fetch(layoutUrl(siteName), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(layout),
      })
      if (!res.ok) throw new Error(`save layout ${siteName}: HTTP ${res.status}`)
      return (await res.json()) as SiteLayout
    },
    onSuccess: (_data, { siteName }) => {
      void qc.invalidateQueries({ queryKey: ['layout', siteName] })
    },
  })
}
