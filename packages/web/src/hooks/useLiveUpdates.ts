import { useEffect, useState } from 'react'
import { useQueryClient, type Query, type QueryClient } from '@tanstack/react-query'
import { apiUrl, type Backend } from '../lib/api'
import { useAppStore } from '../store/useAppStore'
import { useCapabilities } from './useCapabilities'

interface InvalidateEvent { type: 'invalidate'; scope: 'site' | 'all'; site?: string }
export type LiveUpdateStatus = 'connecting' | 'live' | 'reconnecting' | 'polling'

export function eventToInvalidations(backend: Backend, event: InvalidateEvent) {
  const siteKey = event.scope === 'site' && event.site ? ['site', backend, event.site] : ['site', backend]
  return [{ queryKey: siteKey }, { queryKey: ['sites', backend] }, { queryKey: ['circuits', backend] }, { queryKey: ['devices', backend] }]
}

const isActiveTopologyQuery = (backend: Backend, query: Query): boolean => {
  const [kind, queryBackend] = query.queryKey
  return query.isActive() && queryBackend === backend && (kind === 'site' || kind === 'sites' || kind === 'circuits')
}

interface LiveUpdateOptions {
  backend: Backend
  liveUpdatesAvailable: boolean
  queryClient: QueryClient
  createEventSource: (url: string) => Pick<EventSource, 'onopen' | 'onerror' | 'onmessage' | 'close'>
  isVisible: () => boolean
  onVisibilityChange: (handler: () => void) => () => void
  onStatus: (status: LiveUpdateStatus) => void
}

export function startLiveUpdates(options: LiveUpdateOptions): () => void {
  const { backend, queryClient } = options
  let disconnected = !options.liveUpdatesAvailable
  const refresh = () => {
    if (options.isVisible()) void queryClient.invalidateQueries({ predicate: (query) => isActiveTopologyQuery(backend, query) })
  }
  const timer = setInterval(() => { if (disconnected) refresh() }, 60_000)
  const removeVisibilityListener = options.onVisibilityChange(() => { if (disconnected) refresh() })
  let source: ReturnType<LiveUpdateOptions['createEventSource']> | undefined
  if (options.liveUpdatesAvailable) {
    options.onStatus('connecting')
    source = options.createEventSource(apiUrl(backend, '/events'))
    source.onopen = () => {
      const reconnect = disconnected
      disconnected = false
      options.onStatus('live')
      if (reconnect) refresh()
    }
    source.onerror = () => { disconnected = true; options.onStatus('reconnecting') }
    source.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as InvalidateEvent
        if (event.type !== 'invalidate') return
        for (const filter of eventToInvalidations(backend, event)) void queryClient.invalidateQueries(filter)
      } catch { /* ignore malformed frames */ }
    }
  } else options.onStatus('polling')
  return () => { clearInterval(timer); removeVisibilityListener(); source?.close() }
}

export function useLiveUpdates(): LiveUpdateStatus {
  const backend = useAppStore((s) => s.backend)
  const queryClient = useQueryClient()
  const { liveUpdatesAvailable } = useCapabilities()
  const [status, setStatus] = useState<LiveUpdateStatus>('connecting')
  useEffect(() => startLiveUpdates({
    backend, liveUpdatesAvailable, queryClient,
    createEventSource: (url) => new EventSource(url),
    isVisible: () => document.visibilityState === 'visible',
    onVisibilityChange: (handler) => {
      document.addEventListener('visibilitychange', handler)
      return () => document.removeEventListener('visibilitychange', handler)
    },
    onStatus: setStatus,
  }), [backend, liveUpdatesAvailable, queryClient])
  return status
}
