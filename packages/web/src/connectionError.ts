// Turn a raw query error from the data hooks into an actionable HUD line.
// The proxy answers 502 when it cannot reach NetBox (see server app.ts); a
// failed fetch means the net3d server itself is unreachable.
export function connectionErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  if (/HTTP 502/.test(detail)) {
    return 'Can’t reach NetBox — check the net3d server logs and your .env (NETBOX_URL / NETBOX_TOKEN).'
  }
  if (/failed to fetch|networkerror|fetch failed/i.test(detail)) {
    return 'Can’t reach the net3d server — is it running on the API port?'
  }
  return `Couldn’t load sites: ${detail}`
}
