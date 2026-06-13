import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Warm the site-detail query before the user commits to entering a site
 * (marker hover, zoom approaching the enter threshold), so the map→site
 * transition is a cache hit. The server pre-warms its own cache, so this
 * fetch is cheap.
 */
export function useSitePrefetch() {
  const queryClient = useQueryClient()

  return useCallback(
    (siteName: string) => {
      void queryClient.prefetchQuery({
        queryKey: ['site', siteName],
        queryFn: async () => {
          const res = await fetch(`/api/sites/${encodeURIComponent(siteName)}`)
          if (!res.ok) throw new Error(`site ${siteName}: HTTP ${res.status}`)
          return res.json()
        },
        staleTime: 300_000,
      })
    },
    [queryClient],
  )
}
