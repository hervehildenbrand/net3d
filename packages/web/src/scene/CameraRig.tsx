import { useEffect, useRef } from 'react'
import { CameraControls } from '@react-three/drei'
import { latLonToVector3 } from '@net3d/shared'
import { useAppStore } from '../store/useAppStore'
import type { Site } from '../hooks/useSites'
import { useSiteDetail } from '../hooks/useSiteDetail'
import { useSiteLayout } from './SiteLevel'
import { GLOBE_RADIUS } from './GlobeLevel'

// Most sites are in Europe — the globe "home" framing faces them.
export const HOME = latLonToVector3(48, 5, 5.5)

export function CameraRig({ sites }: { sites: Site[] }) {
  const controls = useRef<CameraControls>(null)
  const level = useAppStore((s) => s.level)
  const siteName = useAppStore((s) => s.selectedSiteName)
  const rackId = useAppStore((s) => s.selectedRackId)
  const { data: siteDetail } = useSiteDetail(level !== 'globe' ? siteName : null)
  const { placements, bounds } = useSiteLayout(siteDetail?.racks)

  useEffect(() => {
    const c = controls.current
    if (!c) return

    if (level === 'globe') {
      void c.setLookAt(HOME.x, HOME.y, HOME.z, 0, 0, 0, true)
      return
    }

    if (level === 'site' && siteName) {
      if (!siteDetail) {
        // data still loading — hold near the marker so the transition starts moving
        const site = sites.find((s) => s.name === siteName)
        if (site && site.latitude !== null && site.longitude !== null) {
          const t = latLonToVector3(site.latitude, site.longitude, GLOBE_RADIUS)
          const cam = latLonToVector3(site.latitude, site.longitude, GLOBE_RADIUS + 0.8)
          void c.setLookAt(cam.x, cam.y, cam.z, t.x, t.y, t.z, true)
        }
        return
      }
      const cx = (bounds.max.x + bounds.min.x) / 2
      const cz = (bounds.max.z + bounds.min.z) / 2
      const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 4)
      void c.setLookAt(cx + span * 0.55, span * 0.7, cz + span * 0.95, cx, 1, cz, true)
      return
    }

    if (level === 'rack' && rackId) {
      const p = placements.find((pl) => pl.rackId === rackId)
      if (!p) return
      // face the rack front (+z), slightly right so side labels stay readable
      void c.setLookAt(
        p.x + 0.9,
        p.height * 0.55,
        p.z + p.depth / 2 + 2.1,
        p.x,
        p.height / 2,
        p.z,
        true,
      )
    }
  }, [level, siteName, rackId, sites, siteDetail, bounds, placements])

  return <CameraControls ref={controls} minDistance={0.05} maxDistance={14} smoothTime={0.6} />
}
