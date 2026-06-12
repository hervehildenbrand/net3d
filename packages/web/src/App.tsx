import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import { latLonToVector3 } from '@net3d/shared'
import { GlobeLevel } from './scene/GlobeLevel'
import { useSites } from './hooks/useSites'

// Most sites are in Europe — start the camera facing them.
const home = latLonToVector3(48, 5, 5.5)

export function App() {
  const { data: sites, isLoading, error } = useSites()

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas camera={{ position: [home.x, home.y, home.z], fov: 50 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[home.x, home.y + 3, home.z]} intensity={1.6} />
        <Stars radius={60} depth={30} count={3000} factor={3} fade />
        {sites && <GlobeLevel sites={sites} />}
        <OrbitControls enablePan={false} minDistance={2.6} maxDistance={12} />
      </Canvas>
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          color: '#9fc3e0',
          fontFamily: 'ui-monospace, monospace',
          fontSize: 13,
          pointerEvents: 'none',
        }}
      >
        <strong style={{ color: '#e8f4ff' }}>net3d</strong>
        <div>
          {isLoading && 'loading sites…'}
          {error && `error: ${String(error)}`}
          {sites &&
            `${sites.length} sites — ${sites.filter((s) => s.latitude !== null).length} geocoded`}
        </div>
      </div>
    </div>
  )
}
