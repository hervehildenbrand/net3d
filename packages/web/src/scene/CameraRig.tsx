import { useCallback, useEffect, useRef } from 'react'
import { CameraControls } from '@react-three/drei'
import { useAppStore } from '../store/useAppStore'
import { useSiteDetail } from '../hooks/useSiteDetail'
import { useSiteLayout } from './SiteLevel'

const SIGNAL_INTERVAL_MS = 120

export function CameraRig() {
  const controls = useRef<CameraControls>(null)
  const level = useAppStore((s) => s.level)
  const siteName = useAppStore((s) => s.selectedSiteName)
  const rackId = useAppStore((s) => s.selectedRackId)
  const { data: siteDetail } = useSiteDetail(level !== 'map' ? siteName : null)
  const { placements, bounds } = useSiteLayout(siteDetail?.racks)
  const handleCameraSignals = useAppStore((s) => s.handleCameraSignals)
  const lastSignal = useRef(0)

  // Feed camera distances into the zoom navigation machine (throttled).
  const onControlsChange = useCallback(() => {
    const c = controls.current
    if (!c || placements.length === 0) return
    const now = performance.now()
    if (now - lastSignal.current < SIGNAL_INTERVAL_MS) return
    lastSignal.current = now

    const cam = c.camera.position
    const cx = (bounds.max.x + bounds.min.x) / 2
    const cz = (bounds.max.z + bounds.min.z) / 2
    const distToSite = Math.hypot(cam.x - cx, cam.y - 1, cam.z - cz)
    // same span the fly-in uses — sizes the exit thresholds for big buildings
    const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 4)

    const current = useAppStore.getState()
    let distToRack: number | null = null
    let nearestRackId: string | null = null
    if (current.level === 'rack' && current.selectedRackId) {
      const p = placements.find((pl) => pl.rackId === current.selectedRackId)
      if (p) distToRack = Math.hypot(cam.x - p.x, cam.y - p.height / 2, cam.z - p.z)
    } else {
      for (const p of placements) {
        const d = Math.hypot(cam.x - p.x, cam.y - p.height / 2, cam.z - p.z)
        if (distToRack === null || d < distToRack) {
          distToRack = d
          nearestRackId = p.rackId
        }
      }
    }
    handleCameraSignals(distToSite, distToRack, nearestRackId, span)
  }, [placements, bounds, handleCameraSignals])

  useEffect(() => {
    const c = controls.current
    if (!c) return

    if (level === 'site' && siteDetail) {
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
  }, [level, siteName, rackId, siteDetail, bounds, placements])

  return (
    <CameraControls
      ref={controls}
      minDistance={0.05}
      maxDistance={60}
      smoothTime={0.6}
      onChange={onControlsChange}
    />
  )
}
