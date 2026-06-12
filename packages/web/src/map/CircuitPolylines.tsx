import { useMemo } from 'react'
import { Polyline, Tooltip } from 'react-leaflet'
import {
  commitRateToSpeedBucket,
  formatCommitRate,
  greatCircleLatLngs,
  speedBucketToWidth,
  type CircuitGroup,
} from '@net3d/shared'
import type { Site } from '../hooks/useSites'
import { theme } from '../theme'

/** One geodesic polyline per connected site pair; width follows the pair's top capacity. */
export function CircuitPolylines({
  sites,
  groups,
}: {
  sites: Site[]
  groups: CircuitGroup[]
}) {
  const lines = useMemo(() => {
    const byName = new Map(sites.map((s) => [s.name, s]))
    return groups.flatMap((g) => {
      const a = byName.get(g.siteA)
      const z = byName.get(g.siteZ)
      if (!a || !z || a.latitude === null || z.latitude === null) return []
      const bucket = commitRateToSpeedBucket(g.maxCommitRate ?? null)
      return [
        {
          key: `${g.siteA}|${g.siteZ}`,
          positions: greatCircleLatLngs(a.latitude, a.longitude!, z.latitude, z.longitude!, 48),
          weight: speedBucketToWidth(bucket),
          opacity: bucket === '400G' ? 0.8 : bucket === '100G' ? 0.6 : 0.4,
          title: `${g.siteA} ↔ ${g.siteZ} — ${g.count} circuit${g.count > 1 ? 's' : ''}`,
          circuits: g.circuits ?? [],
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
          pathOptions={{ color: theme.map.circuit, weight: l.weight, opacity: l.opacity }}
        >
          <Tooltip sticky>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.5 }}>
              <strong>{l.title}</strong>
              {l.circuits.map((c) => (
                <div key={c.id} style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
                  <span>{c.cid}</span>
                  <span style={{ color: theme.text.muted }}>
                    {c.provider ?? 'unknown'} · {formatCommitRate(c.commitRate)} · {c.status}
                  </span>
                </div>
              ))}
            </div>
          </Tooltip>
        </Polyline>
      ))}
    </>
  )
}
