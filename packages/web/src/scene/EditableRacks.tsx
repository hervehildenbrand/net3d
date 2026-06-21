import { useCallback, useEffect, useRef, useState } from 'react'
import { Billboard, Instance, Instances, Text } from '@react-three/drei'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { RackPlacement } from '@net3d/shared'
import { theme } from '../theme'
import { useEditStore } from '../store/useEditStore'

// A single shared ground plane (y = 0) the cursor is projected onto, so a drag
// tracks the floor — not the rack mesh — and keeps working off-mesh.
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

/**
 * Racks rendered in edit mode: click to select, drag across the floor to reposition.
 * The drag projects the cursor onto the y=0 plane and updates the working layout in
 * the edit store. CameraControls orbit is disabled for the duration of a drag so the
 * camera doesn't fight the move. window-level listeners keep the drag alive even when
 * the pointer leaves the rack or the canvas.
 */
export function EditableRacks({ placements }: { placements: RackPlacement[] }) {
  const { camera, gl } = useThree()
  const selectedRackId = useEditStore((s) => s.selectedRackId)
  const selectRack = useEditStore((s) => s.selectRack)
  const updateRackPosition = useEditStore((s) => s.updateRackPosition)
  const cameraControlsRef = useEditStore((s) => s.cameraControlsRef)

  const [hovered, setHovered] = useState<string | null>(null)
  const raycaster = useRef(new THREE.Raycaster())
  const drag = useRef<{ rackId: string; offsetX: number; offsetZ: number } | null>(null)

  const groundXZ = useCallback(
    (clientX: number, clientY: number): { x: number; z: number } | null => {
      const rect = gl.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.current.setFromCamera(ndc, camera)
      const hit = new THREE.Vector3()
      return raycaster.current.ray.intersectPlane(GROUND, hit) ? { x: hit.x, z: hit.z } : null
    },
    [camera, gl],
  )

  const setOrbitEnabled = useCallback(
    (enabled: boolean) => {
      const c = cameraControlsRef?.current
      if (c) c.enabled = enabled
    },
    [cameraControlsRef],
  )

  // window-level move/up so the drag survives the cursor leaving the rack/canvas.
  const onWindowMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const hit = groundXZ(e.clientX, e.clientY)
      if (!hit) return
      updateRackPosition(d.rackId, hit.x - d.offsetX, hit.z - d.offsetZ)
    },
    [groundXZ, updateRackPosition],
  )

  const endDrag = useCallback(() => {
    if (!drag.current) return
    drag.current = null
    setOrbitEnabled(true)
    document.body.style.cursor = 'auto'
    window.removeEventListener('pointermove', onWindowMove)
    window.removeEventListener('pointerup', endDrag)
  }, [onWindowMove, setOrbitEnabled])

  // Safety net: tear down listeners + re-enable orbit if unmounted mid-drag.
  useEffect(() => endDrag, [endDrag])

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>, p: RackPlacement) => {
      e.stopPropagation()
      selectRack(p.rackId)
      const hit = groundXZ(e.clientX, e.clientY)
      drag.current = {
        rackId: p.rackId,
        offsetX: hit ? hit.x - p.x : 0,
        offsetZ: hit ? hit.z - p.z : 0,
      }
      setOrbitEnabled(false)
      document.body.style.cursor = 'grabbing'
      window.addEventListener('pointermove', onWindowMove)
      window.addEventListener('pointerup', endDrag)
    },
    [groundXZ, selectRack, setOrbitEnabled, onWindowMove, endDrag],
  )

  return (
    <>
      <Instances limit={placements.length || 1}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" roughness={0.5} metalness={0.4} />
        {placements.map((p) => (
          <Instance
            key={p.rackId}
            // Rotation is encoded as the swapped width/depth footprint (same
            // convention as the normal Racks + applyLayoutOverrides), so a plain
            // rack box reads correctly without a separate rotation transform.
            position={[p.x, p.height / 2, p.z]}
            scale={[p.width, p.height, p.depth]}
            color={
              p.rackId === selectedRackId || hovered === p.rackId
                ? theme.scene.rackHover
                : theme.scene.rack
            }
            onPointerDown={(e) => onPointerDown(e, p)}
            onPointerOver={(e) => {
              e.stopPropagation()
              setHovered(p.rackId)
              if (!drag.current) document.body.style.cursor = 'grab'
            }}
            onPointerOut={() => {
              setHovered(null)
              if (!drag.current) document.body.style.cursor = 'auto'
            }}
          />
        ))}
      </Instances>
      {placements.map((p) => (
        <Billboard key={`edit-label-${p.rackId}`} position={[p.x, p.height + 0.25, p.z]}>
          <Text
            fontSize={0.16}
            color={p.rackId === selectedRackId ? theme.text.primary : theme.text.onScene}
            anchorX="center"
            anchorY="bottom"
          >
            {p.name}
          </Text>
        </Billboard>
      ))}
    </>
  )
}
