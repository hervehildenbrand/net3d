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
  const rackView = useAppStore((s) => s.rackView)
  const { data: siteDetail } = useSiteDetail(level !== 'map' ? siteName : null)
  const { placements, bounds } = useSiteLayout(siteDetail?.racks)
  const handleCameraSignals = useAppStore((s) => s.handleCameraSignals)
  const lastSignal = useRef(0)
  // True while a *programmatic* fly-in/out is animating. The nav machine reads
  // the live camera position every frame; during a button-driven transition that
  // in-flight position is not user intent, so feeding it would let the machine
  // re-fire enterRack on whatever rack the path sweeps past ("← site" landing on
  // the neighbour rack). Suppress signals until the transition settles.
  const transitioning = useRef(false)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Identifies the latest transition so a stale (earlier) fly's promise can't
  // clear the flag for a newer one (e.g. rapid enter-rack → ← site).
  const txnId = useRef(0)

  const beginTransition = useCallback((p: Promise<unknown> | void) => {
    const id = ++txnId.current
    transitioning.current = true
    if (settleTimer.current) clearTimeout(settleTimer.current)
    // The setLookAt promise resolves on *rest* (camera settled at the target),
    // which is the correct moment to re-arm the nav machine: by then we're far
    // from any rack. Only clear if this is still the active transition.
    const done = () => {
      if (txnId.current === id) transitioning.current = false
    }
    if (p && typeof (p as Promise<unknown>).then === 'function') {
      void (p as Promise<unknown>).then(done)
    }
    // Fallback only — long enough to outlast even a big-building fly-out, so it
    // never clears mid-flight (the bug a short timeout caused). The promise is
    // the normal path.
    settleTimer.current = setTimeout(done, 4000)
  }, [])

  useEffect(() => () => clearTimeout(settleTimer.current), [])

  // Feed camera distances into the zoom navigation machine (throttled).
  const onControlsChange = useCallback(() => {
    const c = controls.current
    if (!c || placements.length === 0) return
    if (transitioning.current) return
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
      beginTransition(c.setLookAt(cx + span * 0.55, span * 0.7, cz + span * 0.95, cx, 1, cz, true))
      return
    }

    if (level === 'rack' && rackId) {
      const p = placements.find((pl) => pl.rackId === rackId)
      if (!p) return
      // front: face +z (device faces); rear: face -z (the cabling, as in reality)
      const dir = rackView === 'rear' ? -1 : 1
      beginTransition(
        c.setLookAt(
          p.x + 0.9 * dir,
          p.height * 0.55,
          p.z + dir * (p.depth / 2 + 2.1),
          p.x,
          p.height / 2,
          p.z,
          true,
        ),
      )
    }
  }, [level, siteName, rackId, rackView, siteDetail, bounds, placements, beginTransition])

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
