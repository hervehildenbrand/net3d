import { Canvas } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import { GlobeLevel } from './scene/GlobeLevel'
import { CameraRig, HOME } from './scene/CameraRig'
import { useSites } from './hooks/useSites'
import { useCircuits } from './hooks/useCircuits'
import { useAppStore } from './store/useAppStore'

const hudStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  color: '#9fc3e0',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 13,
}

export function App() {
  const { data: sites, isLoading, error } = useSites()
  const { data: circuitGroups } = useCircuits()
  const level = useAppStore((s) => s.level)
  const selectedSiteName = useAppStore((s) => s.selectedSiteName)
  const zoomToSite = useAppStore((s) => s.zoomToSite)
  const zoomToGlobe = useAppStore((s) => s.zoomToGlobe)

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas camera={{ position: [HOME.x, HOME.y, HOME.z], fov: 50 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[HOME.x, HOME.y + 3, HOME.z]} intensity={1.6} />
        <Stars radius={60} depth={30} count={3000} factor={3} fade />
        {sites && (
          <GlobeLevel
            sites={sites}
            circuitGroups={circuitGroups ?? []}
            onSiteClick={zoomToSite}
            visible
          />
        )}
        {sites && <CameraRig sites={sites} />}
      </Canvas>

      <div style={{ ...hudStyle, pointerEvents: 'none' }}>
        <strong style={{ color: '#e8f4ff' }}>net3d</strong>
        <div>
          {isLoading && 'loading sites…'}
          {error && `error: ${String(error)}`}
          {sites &&
            level === 'globe' &&
            `${sites.length} sites — ${sites.filter((s) => s.latitude !== null).length} geocoded — ${circuitGroups?.length ?? 0} DC links`}
          {level !== 'globe' && selectedSiteName && `site: ${selectedSiteName}`}
        </div>
      </div>

      {level !== 'globe' && (
        <button
          onClick={zoomToGlobe}
          style={{
            ...hudStyle,
            top: 56,
            background: '#13283d',
            color: '#cfe8ff',
            border: '1px solid #2a4a6a',
            borderRadius: 6,
            padding: '6px 12px',
            cursor: 'pointer',
          }}
        >
          ← globe
        </button>
      )}
    </div>
  )
}
