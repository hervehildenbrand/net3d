import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiUrl } from '../lib/api'
import { useAppStore } from '../store/useAppStore'

/**
 * Warm the site-detail query before the user commits to entering a site
 * (marker hover, zoom approaching the enter threshold), so the map→site
 * transition is a cache hit. The server pre-warms its own cache, so this
 * fetch is cheap.
 */
export function useSitePrefetch() {
  const queryClient = useQueryClient()
  const backend = useAppStore((s) => s.backend)

  return useCallback(
    (siteName: string) => {
      void queryClient.prefetchQuery({
        // must match useSiteDetail's key so the map→site transition is a cache hit
        queryKey: ['site', backend, siteName],
        queryFn: async () => {
          const res = await fetch(apiUrl(backend, `/sites/${encodeURIComponent(siteName)}`))
          if (!res.ok) throw new Error(`site ${siteName}: HTTP ${res.status}`)
          return res.json()
        },
        staleTime: 300_000,
      })
    },
    [queryClient, backend],
  )
}
