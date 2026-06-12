import { useMemo } from 'react'
import { Polyline, Tooltip } from 'react-leaflet'
import { greatCircleLatLngs, type CircuitGroup } from '@net3d/shared'
import type { Site } from '../hooks/useSites'

/** One geodesic polyline per connected site pair; weight/opacity follow circuit count. */
export function CircuitPolylines({
  sites,
  groups,
}: {
  sites: Site[]
  groups: CircuitGroup[]
}) {
  const lines = useMemo(() => {
    const byName = new Map(sites.map((s) => [s.name, s]))
    const maxCount = Math.max(1, ...groups.map((g) => g.count))
    return groups.flatMap((g) => {
      const a = byName.get(g.siteA)
      const z = byName.get(g.siteZ)
      if (!a || !z || a.latitude === null || z.latitude === null) return []
      const ratio = g.count / maxCount
      return [
        {
          key: `${g.siteA}|${g.siteZ}`,
          positions: greatCircleLatLngs(a.latitude, a.longitude!, z.latitude, z.longitude!, 48),
          weight: 1.5 + 2.5 * ratio,
          opacity: 0.35 + 0.5 * ratio,
          label: `${g.siteA} ↔ ${g.siteZ} — ${g.count} circuit${g.count > 1 ? 's' : ''}`,
        },
      ]
    })
  }, [sites, groups])

  return (
    <>
      {lines.map((l) => (
        <Polyline
          key={l.key}
          positions={l.positions as [number, number][]}
          pathOptions={{ color: '#0ea5e9', weight: l.weight, opacity: l.opacity }}
        >
          <Tooltip sticky>{l.label}</Tooltip>
        </Polyline>
      ))}
    </>
  )
}
