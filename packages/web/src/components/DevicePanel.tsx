import { useMemo, useState, type ReactNode } from 'react'
import {
  buildCablePath,
  extractFrontRearPairs,
  faceLabel,
  getCablesForDevice,
  interfaceSpeedBucket,
  lldpDiff,
  type LldpNeighbor,
  type TraceCable,
  type TracePath,
} from '@net3d/shared'
import { useCapabilities } from '../hooks/useCapabilities'
import { UnreachableError, useNapalm } from '../hooks/useNapalm'
import type { SiteCable, SiteDevice, SiteRack } from '../hooks/useSiteDetail'
import { deriveRedundancy, deviceFeedSides } from '../lib/powerOverlay'
import { useAppStore } from '../store/useAppStore'
import { theme } from '../theme'

interface Facts {
  vendor: string
  model: string
  serial_number: string
  os_version: string
  hostname: string
  fqdn: string
  uptime: number
}

interface EnvSensor {
  [name: string]: Record<string, unknown>
}
interface Environment {
  temperature?: EnvSensor
  fans?: EnvSensor
  power?: EnvSensor
  cpu?: Record<string, { '%usage'?: number }>
  memory?: { available_ram?: number; used_ram?: number }
}

export interface NapalmInterface {
  is_up: boolean
  is_enabled: boolean
  speed?: number
  description?: string
}

const panel: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  width: 380,
  // Above the 3D <Canvas> (zIndex 2) and HUD (zIndex 20); without this the
  // canvas paints over the panel and swallows every click — incl. the ✕.
  zIndex: 30,
  overflowY: 'auto',
  background: 'rgba(255, 255, 255, 0.96)',
  borderLeft: '1px solid #cbd5e1',
  color: '#334155',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 12,
  padding: '16px 18px',
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ color: '#64748b', textTransform: 'uppercase', fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Row({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '2px 0' }}>
      <span style={{ color: '#64748b' }}>{k}</span>
      <span style={{ textAlign: 'right', wordBreak: 'break-all' }}>{v}</span>
    </div>
  )
}

function Status({ query, label }: { query: { isLoading: boolean; error: unknown }; label: string }) {
  if (query.isLoading)
    return <div style={{ color: '#94a3b8' }}>connecting to device… (live SSH, can take ~30 s)</div>
  if (query.error instanceof UnreachableError)
    return <div style={{ color: '#d97706' }}>⚠ device unreachable via NAPALM</div>
  if (query.error) return <div style={{ color: '#dc2626' }}>error loading {label}</div>
  return null
}

/** Drop the CIDR mask for display: "10.0.0.5/24" → "10.0.0.5". */
function stripMask(addr: string): string {
  return addr.split('/')[0]!
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400)
  const h = Math.floor((seconds % 86_400) / 3_600)
  return `${d}d ${h}h`
}

function LldpAudit({ device, cables }: { device: SiteDevice; cables: SiteCable[] }) {
  const [enabled, setEnabled] = useState(false)
  const lldp = useNapalm<Record<string, LldpNeighbor[]>>(
    enabled ? device.id : null,
    'get_lldp_neighbors',
  )

  if (!enabled) {
    return (
      <button
        onClick={() => setEnabled(true)}
        style={{
          background: '#f8fafc',
          color: '#1e293b',
          border: '1px solid #cbd5e1',
          borderRadius: 6,
          padding: '5px 10px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 11,
        }}
      >
        run audit (live LLDP, ~30 s)
      </button>
    )
  }

  if (lldp.isLoading || lldp.error) return <Status query={lldp} label="LLDP" />

  const diff = lldpDiff(lldp.data ?? {}, cables, device.name)
  return (
    <>
      {diff.matches.map((m) => (
        <Row
          key={m.cableId}
          k={m.localInterface}
          v={<span style={{ color: '#16a34a' }}>✓ {m.neighbor.split('.')[0]}:{m.neighborPort}</span>}
        />
      ))}
      {diff.cableOnly.map((c) => (
        <Row
          key={c.cableId}
          k={c.localInterface}
          v={
            <span style={{ color: '#d97706' }}>
              ⚠ documented {c.documentedNeighbor ?? '?'} — not seen by LLDP
            </span>
          }
        />
      ))}
      {diff.lldpOnly.map((l, i) => (
        <Row
          key={`${l.localInterface}-${i}`}
          k={l.localInterface}
          v={
            <span style={{ color: '#dc2626' }}>
              ＋ LLDP sees {l.neighbor.split('.')[0]}:{l.neighborPort} — no cable in NetBox
            </span>
          }
        />
      ))}
      {diff.matches.length + diff.cableOnly.length + diff.lldpOnly.length === 0 && (
        <div style={{ color: '#94a3b8' }}>no LLDP neighbors and no documented interface cables</div>
      )}
    </>
  )
}

/** Format a TracePath as a compact human-readable string. */
function formatTracePath(trace: TracePath): string {
  if (trace.hops.length === 0) return ''
  const parts: string[] = []
  let i = 0
  while (i < trace.hops.length) {
    const hop = trace.hops[i]!
    if (hop.kind === 'interface') {
      parts.push(`${hop.deviceName ?? '?'}:${hop.portName}`)
      i++
    } else {
      // front/rear port pair: combine them with a bidirectional arrow
      const nextHop = trace.hops[i + 1]
      if (nextHop && nextHop.deviceName === hop.deviceName) {
        parts.push(`${hop.deviceName ?? '?'}:${hop.portName} ⇄ ${nextHop.portName}`)
        i += 2
      } else {
        parts.push(`${hop.deviceName ?? '?'}:${hop.portName}`)
        i++
      }
    }
  }
  return parts.join(' → ')
}

export function DevicePanel({
  device,
  cables,
  rack,
  napalmAvailable = true,
  onClose,
}: {
  device: SiteDevice
  cables: SiteCable[]
  /** The device's rack, used to derive A/B power redundancy from its power cords. */
  rack?: SiteRack
  /** When the NetBox NAPALM plugin is absent, only the NetBox section renders. */
  napalmAvailable?: boolean
  onClose: () => void
}) {
  const liveId = napalmAvailable ? device.id : null
  const facts = useNapalm<Facts>(liveId, 'get_facts')
  const env = useNapalm<Environment>(liveId, 'get_environment')
  const ifaces = useNapalm<Record<string, NapalmInterface>>(liveId, 'get_interfaces')
  const ports = useMemo(() => getCablesForDevice(cables, device.name), [cables, device.name])
  const { backend } = useCapabilities()
  const activeTrace = useAppStore((s) => s.activeTrace)
  const setTrace = useAppStore((s) => s.setTrace)
  const clearTrace = useAppStore((s) => s.clearTrace)

  // ponytail: TraceCable is a structural subset of SiteCable, cast is safe
  const traceCables = cables as unknown as TraceCable[]
  const pairs = useMemo(() => extractFrontRearPairs(traceCables), [traceCables])

  const handleTrace = (interfaceName: string) => {
    const path = buildCablePath(traceCables, pairs, device.name, interfaceName)
    if (path) setTrace(path)
  }
  // cableId -> this device's interface line rate, so the port list can show speeds
  const speedByCable = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of cables) {
      const local = c.a?.deviceName === device.name ? c.a : c.b?.deviceName === device.name ? c.b : null
      const bucket = interfaceSpeedBucket(local?.ifaceType ?? null)
      if (bucket) m.set(c.id, bucket)
    }
    return m
  }, [cables, device.name])
  // A/B power redundancy from the device's power cords (needs the rack for its PDUs).
  const redundancy = useMemo(() => (rack ? deriveRedundancy(device.name, rack, cables) : 'none'), [rack, device.name, cables])
  const feedSides = useMemo(
    () => (rack ? [...deviceFeedSides(device.name, rack, cables)].sort() : []),
    [rack, device.name, cables],
  )
  const active = device.status === 'active'

  return (
    <div style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <strong style={{ color: '#1e293b', fontSize: 14, overflowWrap: 'anywhere' }}>{device.name}</strong>
          <span
            style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
              background: active ? '#dcfce7' : '#fef3c7',
              color: active ? '#166534' : '#92400e',
            }}
          >
            {device.status}
          </span>
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16 }}
        >
          ✕
        </button>
      </div>

      <Section title="NetBox">
        <Row k="role" v={device.roleName} />
        <Row k="model" v={`${device.manufacturer} ${device.model}`} />
        {device.platform && <Row k="platform" v={device.platform} />}
        <Row k="position" v={device.position !== null ? `U${device.position} · ${faceLabel(device.face, device.isFullDepth)}` : 'unpositioned'} />
        {device.primaryIp && <Row k="mgmt ip" v={stripMask(device.primaryIp)} />}
        {device.oobIp && <Row k="oob ip" v={stripMask(device.oobIp)} />}
        {device.serial && <Row k="serial" v={device.serial} />}
        {device.assetTag && <Row k="asset tag" v={device.assetTag} />}
        {device.description && <Row k="notes" v={device.description} />}
      </Section>

      {device.specs && (
        <Section title="Hardware">
          {device.specs.cpuModel && <Row k="cpu" v={device.specs.cpuModel} />}
          {device.specs.cpuCores !== undefined && <Row k="cores" v={device.specs.cpuCores} />}
          {device.specs.ramGb !== undefined && <Row k="memory" v={`${device.specs.ramGb} GB`} />}
          {device.specs.storageTb !== undefined && <Row k="storage" v={`${device.specs.storageTb} TB`} />}
          {device.specs.powerDrawW !== undefined && <Row k="power draw" v={`${device.specs.powerDrawW} W`} />}
        </Section>
      )}

      {redundancy !== 'none' && (
        <Section title="Power">
          <Row
            k="redundancy"
            v={
              <span style={{ color: redundancy === 'dual' ? '#166534' : '#b45309', fontWeight: 600 }}>
                {redundancy === 'dual'
                  ? '⚡ A + B redundant'
                  : `⚠ single feed (${feedSides.join('')} only)`}
              </span>
            }
          />
        </Section>
      )}

      <Section title={`Port allocation${ports.length ? ` (${ports.length})` : ''}`}>
        {ports.length === 0 && <div style={{ color: '#94a3b8' }}>no documented cables</div>}
        {ports.map((p) => (
          <div key={p.cableId} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
            <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: p.kind === 'mgmt' ? theme.cable.mgmt : '#64748b' }}>
                {p.interfaceName}
                {speedByCable.has(p.cableId) && (
                  <span style={{ color: '#94a3b8', marginLeft: 6 }}>{speedByCable.get(p.cableId)}</span>
                )}
              </span>
              <span style={{ textAlign: 'right', wordBreak: 'break-all' }}>
                {`→ ${p.remoteRackName ? `${p.remoteRackName} / ` : ''}${p.remoteDeviceName ?? '?'} : ${p.remoteInterfaceName ?? '?'}`}
              </span>
            </div>
            {backend === 'netbox' && (p.kind === 'data' || p.kind === 'mgmt') && (
              <button
                onClick={() => handleTrace(p.interfaceName)}
                title="trace through patch panels"
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: 11,
                  padding: '0 2px',
                }}
              >
                ↯
              </button>
            )}
          </div>
        ))}
      </Section>

      {backend === 'infrahub' && (
        <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 14 }}>
          Cable trace through patch panels — not available on this backend
        </div>
      )}

      {backend === 'netbox' && activeTrace && (
        <Section title="Cable trace">
          <div style={{ fontSize: 11, lineHeight: 1.5, wordBreak: 'break-word' }}>
            {formatTracePath(activeTrace)}
          </div>
          <div style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>
            {activeTrace.cableIds.length} cable{activeTrace.cableIds.length !== 1 ? 's' : ''}
            {activeTrace.panelCount > 0 && ` · via ${activeTrace.panelCount} patch panel${activeTrace.panelCount !== 1 ? 's' : ''}`}
            {!activeTrace.complete && <span style={{ color: '#d97706' }}> · path incomplete</span>}
          </div>
          <button
            onClick={clearTrace}
            style={{
              background: '#f8fafc',
              color: '#64748b',
              border: '1px solid #cbd5e1',
              borderRadius: 4,
              padding: '3px 8px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 10,
              marginTop: 6,
            }}
          >
            clear
          </button>
        </Section>
      )}

      {!napalmAvailable && (
        <div style={{ color: '#94a3b8', marginBottom: 14 }}>
          live data unavailable — NetBox NAPALM plugin not detected
        </div>
      )}

      {napalmAvailable && (
      <>
      <Section title="Facts (NAPALM)">
        <Status query={facts} label="facts" />
        {facts.data && (
          <>
            <Row k="hostname" v={facts.data.fqdn || facts.data.hostname} />
            <Row k="os" v={facts.data.os_version} />
            <Row k="serial" v={facts.data.serial_number} />
            <Row k="uptime" v={formatUptime(facts.data.uptime)} />
          </>
        )}
      </Section>

      <Section title="Environment">
        <Status query={env} label="environment" />
        {env.data?.cpu &&
          Object.entries(env.data.cpu).slice(0, 4).map(([cpu, v]) => (
            <Row key={cpu} k={`cpu ${cpu}`} v={`${v['%usage'] ?? '?'}%`} />
          ))}
        {env.data?.memory?.used_ram !== undefined && env.data.memory.available_ram !== undefined && (
          <Row
            k="memory"
            v={`${Math.round((env.data.memory.used_ram / env.data.memory.available_ram) * 100)}% used`}
          />
        )}
        {env.data?.temperature &&
          Object.entries(env.data.temperature)
            .filter(([, v]) => typeof v.temperature === 'number')
            .slice(0, 6)
            .map(([sensor, v]) => <Row key={sensor} k={sensor} v={`${v.temperature}°C`} />)}
      </Section>

      <Section title="LLDP audit — NetBox vs reality">
        <LldpAudit device={device} cables={cables} />
      </Section>

      <Section title={`Interfaces${ifaces.data ? ` (${Object.keys(ifaces.data).length})` : ''}`}>
        <Status query={ifaces} label="interfaces" />
        {ifaces.data &&
          Object.entries(ifaces.data)
            .filter(([name]) => !/^(lo|pfh|pfe|em|fxp|fti|cbp|pip|irb|vtep|esi|tap|dsc|gre|ipip|jsrv|lsi|mtun|pimd|pime|rbeb|vme)/.test(name))
            .slice(0, 40)
            .map(([name, i]) => (
              <Row
                key={name}
                k={name}
                v={
                  <span style={{ color: i.is_up ? '#16a34a' : i.is_enabled ? '#dc2626' : '#cbd5e1' }}>
                    {i.is_up ? '● up' : i.is_enabled ? '● down' : '○ disabled'}
                  </span>
                }
              />
            ))}
      </Section>
      </>
      )}
    </div>
  )
}
