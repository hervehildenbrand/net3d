import { useQuery } from '@tanstack/react-query'
import { API_PREFIX, type Backend } from '../lib/api'
import { useAppStore } from '../store/useAppStore'
import { theme } from '../theme'
import netboxLogo from '../assets/netbox.svg'
import infrahubLogo from '../assets/infrahub.svg'

const BACKENDS: { id: Backend; label: string; logo: string }[] = [
  { id: 'netbox', label: 'NetBox', logo: netboxLogo },
  { id: 'infrahub', label: 'Infrahub', logo: infrahubLogo },
]

/**
 * Is the server for `backend` answering? Each backend runs as its own instance
 * behind a distinct API prefix; an unreachable one (e.g. only NetBox running in
 * dev) is shown disabled rather than letting the user switch to a dead backend.
 * Defaults to reachable until a probe proves otherwise, so the active backend is
 * never disabled on first paint.
 */
function useBackendReachable(backend: Backend): boolean {
  const { data } = useQuery({
    queryKey: ['health', backend],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_PREFIX[backend]}/health`)
        return res.ok
      } catch {
        return false
      }
    },
    staleTime: 30_000,
    retry: false,
  })
  return data ?? true
}

/** Pick the source of truth (NetBox or Infrahub). Switching resets the view to the map. */
export function BackendSwitcher() {
  const backend = useAppStore((s) => s.backend)
  const setBackend = useAppStore((s) => s.setBackend)
  const reachable: Record<Backend, boolean> = {
    netbox: useBackendReachable('netbox'),
    infrahub: useBackendReachable('infrahub'),
  }

  return (
    <div
      role="group"
      aria-label="source of truth"
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 20,
        display: 'flex',
        gap: 2,
        padding: 3,
        background: theme.hud.background,
        border: `1px solid ${theme.hud.border}`,
        borderRadius: 8,
        boxShadow: theme.hud.shadow,
        fontFamily: 'ui-monospace, monospace',
        fontSize: 13,
      }}
    >
      {BACKENDS.map(({ id, label, logo }) => {
        const active = id === backend
        // never disable the backend you're currently on
        const disabled = !active && !reachable[id]
        return (
          <button
            key={id}
            onClick={() => setBackend(id)}
            disabled={disabled}
            title={disabled ? `${label} server not reachable` : `View data from ${label}`}
            aria-pressed={active}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '5px 10px',
              borderRadius: 6,
              border: 'none',
              cursor: disabled ? 'not-allowed' : 'pointer',
              background: active ? theme.hud.accent : 'transparent',
              color: active ? '#ffffff' : theme.text.primary,
              opacity: disabled ? 0.4 : 1,
              fontFamily: 'inherit',
              fontSize: 'inherit',
            }}
          >
            <img src={logo} alt="" width={16} height={16} style={{ display: 'block' }} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
