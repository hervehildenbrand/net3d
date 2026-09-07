import type { LldpDiscovery } from '../hooks/useLldpDiscovery'

export function LldpHud({
  discovery,
  undocumentedLinks,
}: {
  discovery: LldpDiscovery
  undocumentedLinks: number
}) {
  if (discovery.total === 0) return null
  if (discovery.discovering) {
    return (
      <div style={{ color: '#0891b2' }}>
        ◐ discovering cabling {discovery.completed}/{discovery.total} devices… ({discovery.pending}{' '}
        pending{discovery.failed > 0 ? `, ${discovery.failed} failed` : ''})
      </div>
    )
  }
  return (
    <div style={{ color: discovery.failed > 0 ? '#b45309' : '#0891b2' }}>
      ▣ LLDP: {discovery.successful}/{discovery.total} devices
      {discovery.successful > 0 && (
        <>
          {' — '}
          {undocumentedLinks} undocumented link{undocumentedLinks === 1 ? '' : 's'}
        </>
      )}
      {discovery.failed > 0 && (
        <>
          {' — '}
          {discovery.failed} failed{' '}
          <button
            type="button"
            onClick={() => void discovery.retryFailed()}
            style={{ pointerEvents: 'auto', font: 'inherit' }}
          >
            Retry failed
          </button>
        </>
      )}
    </div>
  )
}
