import { useMemo } from 'react'
import { applyLayoutOverrides } from '@net3d/shared'
import type { SiteRack } from './useSiteDetail'
import { useSiteLayoutQuery } from './useSiteLayout'
import { useAppStore } from '../store/useAppStore'

export function useComputedSiteLayout(racks: SiteRack[] | undefined) {
  const siteName = useAppStore((s) => s.selectedSiteName)
  const { data: layout } = useSiteLayoutQuery(siteName)
  return useMemo(() => {
    const applied = applyLayoutOverrides(
      (racks ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        uHeight: r.uHeight,
        location: r.location,
      })),
      layout ?? null,
    )
    return { placements: applied.placements, bounds: applied.bounds, rooms: applied.rooms }
  }, [racks, layout])
}
