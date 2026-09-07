interface Props {
  siteName: string
  loading: boolean
  fetching: boolean
  error: unknown
  rackCount: number | undefined
  onRetry: () => void
}

export function SiteStatus({ siteName, loading, fetching, error, rackCount, onRetry }: Props) {
  const retry = !!error && (
    <button type="button" onClick={onRetry} style={{ marginLeft: 8, color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 4, background: '#fff', cursor: 'pointer', font: 'inherit' }}>
      Retry
    </button>
  )
  if (rackCount === undefined) {
    if (loading) return <>site: {siteName} — loading racks…</>
    if (error) return <span style={{ color: '#b91c1c' }}>⚠ Site data unavailable ({error instanceof Error ? error.message : 'request failed'}). Check the source of truth and retry.{retry}</span>
    return <>site: {siteName}</>
  }
  return (
    <>
      site: {siteName} — {rackCount === 0 ? 'no racks' : `${rackCount} racks`}
      {fetching && !error && ' — refreshing…'}
      {!!error && <span style={{ color: '#b91c1c' }}> — showing cached data; refresh failed.{retry}</span>}
    </>
  )
}
