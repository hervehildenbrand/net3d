import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiUrl, type Backend } from '../lib/api'
import { useAppStore } from '../store/useAppStore'

interface InvalidateEvent {
  type: 'invalidate'
  scope: 'site' | 'all'
  site?: string
}

/** react-query filters to invalidate for one SSE event (prefix-matched by default). */
export function eventToInvalidations(backend: Backend, event: InvalidateEvent) {
  const siteKey =
    event.scope === 'site' && event.site ? ['site', backend, event.site] : ['site', backend]
  return [
    { queryKey: siteKey },
    { queryKey: ['sites', backend] },
    { queryKey: ['circuits', backend] },
    { queryKey: ['devices', backend] },
  ]
}

/**
 * Subscribe to the server's invalidation stream (/api/events) so SoT edits show
 * up without a reload. EventSource auto-reconnects; a 404 (webhooks disabled
 * server-side) just keeps erroring quietly — the UI falls back to TTL refresh.
 */
export function useLiveUpdates(): void {
  const backend = useAppStore((s) => s.backend)
  const queryClient = useQueryClient()

  useEffect(() => {
    const es = new EventSource(apiUrl(backend, '/events'))
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as InvalidateEvent
        if (event.type !== 'invalidate') return
        for (const filter of eventToInvalidations(backend, event)) {
          void queryClient.invalidateQueries(filter)
        }
      } catch {
        /* ignore malformed frames */
      }
    }
    return () => es.close()
  }, [backend, queryClient])
}
