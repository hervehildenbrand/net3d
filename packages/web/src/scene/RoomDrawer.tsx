import { useCallback, useEffect, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { snapToGrid } from '@net3d/shared'
import { useEditStore } from '../store/useEditStore'

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const MIN_ROOM_M = 0.5 // ignore accidental tiny rubber-bands

interface Rect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/**
 * Mounted only in add-room mode. Renders a large invisible floor plane that
 * captures a click-drag, rubber-banding a rectangle on the y=0 plane and
 * committing it as a room on release. Snaps corners to the active grid.
 */
export function RoomDrawer() {
  const { camera, gl } = useThree()
  const gridSnap = useEditStore((s) => s.gridSnap)
  const commitRoom = useEditStore((s) => s.commitRoom)

  const raycaster = useRef(new THREE.Raycaster())
  const start = useRef<{ x: number; z: number } | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)

  const groundXZ = useCallback(
    (clientX: number, clientY: number): { x: number; z: number } | null => {
      const r = gl.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((clientX - r.left) / r.width) * 2 - 1,
        -((clientY - r.top) / r.height) * 2 + 1,
      )
      raycaster.current.setFromCamera(ndc, camera)
      const hit = new THREE.Vector3()
      if (!raycaster.current.ray.intersectPlane(GROUND, hit)) return null
      return { x: snapToGrid(hit.x, gridSnap), z: snapToGrid(hit.z, gridSnap) }
    },
    [camera, gl, gridSnap],
  )

  const rectFrom = (a: { x: number; z: number }, b: { x: number; z: number }): Rect => ({
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minZ: Math.min(a.z, b.z),
    maxZ: Math.max(a.z, b.z),
  })

  const onMove = useCallback(
    (e: PointerEvent) => {
      if (!start.current) return
      const hit = groundXZ(e.clientX, e.clientY)
      if (hit) setRect(rectFrom(start.current, hit))
    },
    [groundXZ],
  )

  const onUp = useCallback(() => {
    const s = start.current
    start.current = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    setRect((cur) => {
      if (s && cur && cur.maxX - cur.minX >= MIN_ROOM_M && cur.maxZ - cur.minZ >= MIN_ROOM_M) {
        commitRoom({
          x: (cur.minX + cur.maxX) / 2,
          z: (cur.minZ + cur.maxZ) / 2,
          width: cur.maxX - cur.minX,
          depth: cur.maxZ - cur.minZ,
        })
      }
      return null
    })
  }, [onMove, commitRoom])

  useEffect(() => () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }, [onMove, onUp])

  const onDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      const hit = groundXZ(e.clientX, e.clientY)
      if (!hit) return
      start.current = hit
      setRect(rectFrom(hit, hit))
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [groundXZ, onMove, onUp],
  )

  return (
    <>
      {/* invisible capture surface for the drag */}
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} onPointerDown={onDown}>
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* live rubber-band preview */}
      {rect && rect.maxX > rect.minX && (
        <mesh
          position={[(rect.minX + rect.maxX) / 2, 0.03, (rect.minZ + rect.maxZ) / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
          raycast={() => null}
        >
          <planeGeometry args={[rect.maxX - rect.minX, rect.maxZ - rect.minZ]} />
          <meshBasicMaterial color="#0891b2" transparent opacity={0.35} depthWrite={false} />
        </mesh>
      )}
    </>
  )
}
