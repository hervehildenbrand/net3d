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

const REPO_URL = 'https://github.com/hervehildenbrand/net3d'

/** Official GitHub mark (Octicons); inherits the link color via currentColor. */
function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" width={18} height={18} fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

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
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="View net3d on GitHub"
        aria-label="View net3d on GitHub"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 34,
          height: 34,
          background: theme.hud.background,
          border: `1px solid ${theme.hud.border}`,
          borderRadius: 8,
          boxShadow: theme.hud.shadow,
          color: theme.text.primary,
          textDecoration: 'none',
        }}
      >
        <GithubMark />
      </a>
      <div
        role="group"
        aria-label="source of truth"
        style={{
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
    </div>
  )
}
