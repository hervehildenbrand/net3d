import { useEffect, useRef } from 'react'
import { CameraControls } from '@react-three/drei'
import { latLonToVector3 } from '@net3d/shared'
import { useAppStore } from '../store/useAppStore'
import type { Site } from '../hooks/useSites'
import { GLOBE_RADIUS } from './GlobeLevel'

// Most sites are in Europe — the globe "home" framing faces them.
export const HOME = latLonToVector3(48, 5, 5.5)

export function CameraRig({ sites }: { sites: Site[] }) {
  const controls = useRef<CameraControls>(null)
  const level = useAppStore((s) => s.level)
  const siteName = useAppStore((s) => s.selectedSiteName)

  useEffect(() => {
    const c = controls.current
    if (!c) return
    if (level === 'globe') {
      void c.setLookAt(HOME.x, HOME.y, HOME.z, 0, 0, 0, true)
      return
    }
    if (level === 'site' && siteName) {
      const site = sites.find((s) => s.name === siteName)
      if (site && site.latitude !== null && site.longitude !== null) {
        const target = latLonToVector3(site.latitude, site.longitude, GLOBE_RADIUS)
        const cam = latLonToVector3(site.latitude, site.longitude, GLOBE_RADIUS + 0.8)
        void c.setLookAt(cam.x, cam.y, cam.z, target.x, target.y, target.z, true)
      }
    }
  }, [level, siteName, sites])

  return <CameraControls ref={controls} minDistance={0.05} maxDistance={12} smoothTime={0.6} />
}
