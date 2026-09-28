import { useMemo } from 'react'
import { queryOptions, useQuery } from '@tanstack/react-query'
import type { CircuitLive } from '@net3d/shared'
import { apiUrl, type Backend } from '../lib/api'
import { useAppStore } from '../store/useAppStore'

const POLL_MS = 5_000

interface CircuitTelemetryResponse {
  circuits: Record<string, CircuitLive>
}

export function circuitTelemetryQueryOptions(backend: Backend) {
  return queryOptions({
    queryKey: ['circuit-telemetry', backend] as const,
    queryFn: async ({ signal }): Promise<CircuitTelemetryResponse> => {
      const res = await fetch(apiUrl(backend, '/telemetry/circuits'), { signal })
      if (!res.ok) throw new Error(`circuits telemetry: HTTP ${res.status}`)
      return res.json()
    },
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  })
}

/** Latest circuit telemetry as Map; undefined while loading or after error (render static). */
export function useCircuitTelemetry(enabled: boolean): Map<string, CircuitLive> | undefined {
  const backend = useAppStore((s) => s.backend)
  const { data, isError } = useQuery({ ...circuitTelemetryQueryOptions(backend), enabled })
  return useMemo(
    () => (isError || !data ? undefined : new Map(Object.entries(data.circuits))),
    [data, isError],
  )
}
