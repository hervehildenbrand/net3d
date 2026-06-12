import type { ReactNode } from 'react'
import { UnreachableError, useNapalm } from '../hooks/useNapalm'
import type { SiteDevice } from '../hooks/useSiteDetail'

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
  overflowY: 'auto',
  background: 'rgba(10, 20, 32, 0.95)',
  borderLeft: '1px solid #2a4a6a',
  color: '#cfe8ff',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 12,
  padding: '16px 18px',
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ color: '#7fb3d8', textTransform: 'uppercase', fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '2px 0' }}>
      <span style={{ color: '#88a8c4' }}>{k}</span>
      <span style={{ textAlign: 'right', wordBreak: 'break-all' }}>{v}</span>
    </div>
  )
}

function Status({ query, label }: { query: { isLoading: boolean; error: unknown }; label: string }) {
  if (query.isLoading)
    return <div style={{ color: '#5d83a6' }}>connecting to device… (live SSH, can take ~30 s)</div>
  if (query.error instanceof UnreachableError)
    return <div style={{ color: '#e0a056' }}>⚠ device unreachable via NAPALM</div>
  if (query.error) return <div style={{ color: '#e05656' }}>error loading {label}</div>
  return null
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400)
  const h = Math.floor((seconds % 86_400) / 3_600)
  return `${d}d ${h}h`
}

export function DevicePanel({ device, onClose }: { device: SiteDevice; onClose: () => void }) {
  const facts = useNapalm<Facts>(device.id, 'get_facts')
  const env = useNapalm<Environment>(device.id, 'get_environment')
  const ifaces = useNapalm<Record<string, NapalmInterface>>(device.id, 'get_interfaces')

  return (
    <div style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <strong style={{ color: '#e8f4ff', fontSize: 14 }}>{device.name}</strong>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#7fb3d8', cursor: 'pointer', fontSize: 16 }}
        >
          ✕
        </button>
      </div>

      <Section title="NetBox">
        <Row k="role" v={device.roleName} />
        <Row k="model" v={`${device.manufacturer} ${device.model}`} />
        <Row k="position" v={device.position !== null ? `U${device.position} · ${device.face ?? ''}` : 'unpositioned'} />
      </Section>

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
                  <span style={{ color: i.is_up ? '#5ee08a' : i.is_enabled ? '#e05656' : '#557' }}>
                    {i.is_up ? '● up' : i.is_enabled ? '● down' : '○ disabled'}
                  </span>
                }
              />
            ))}
      </Section>
    </div>
  )
}
