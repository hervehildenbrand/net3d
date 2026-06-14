// A loud, fail-fast preflight: confirm NETBOX_URL + NETBOX_TOKEN actually reach
// a working NetBox before the server claims it's up. This is deliberately
// separate from the client's netboxMajor() probe, which swallows errors and
// defaults to v3 so on-demand requests degrade rather than crash — at boot we
// want the opposite: surface the real reason with an actionable hint.

export interface ConnectionInfo {
  /** Reported NetBox version string, or null if absent from /api/status/. */
  version: string | null
  napalmAvailable: boolean
}

/** A preflight failure that already carries a human-actionable remedy. */
export class ConnectionCheckError extends Error {
  readonly hint: string
  constructor(message: string, hint: string) {
    super(message)
    this.name = 'ConnectionCheckError'
    this.hint = hint
  }
}

// Node/undici surfaces low-level failures as `TypeError: fetch failed` with the
// real cause (and its libuv/OpenSSL code) on `.cause`.
const CERT_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

function causeCode(err: unknown): string | undefined {
  return (err as { cause?: { code?: string } } | undefined)?.cause?.code
}

function networkFailure(err: unknown): { message: string; hint: string } {
  const code = causeCode(err)
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return { message: 'cannot resolve the NetBox hostname', hint: 'Hostname not found — check NETBOX_URL.' }
    case 'ECONNREFUSED':
      return {
        message: 'the NetBox host refused the connection',
        hint: 'Is NetBox running and is the port correct? Check NETBOX_URL.',
      }
    default:
      if (code && CERT_CODES.has(code)) {
        return {
          message: `the NetBox TLS certificate is not trusted (${code})`,
          hint: 'Set NETBOX_TLS_VERIFY=false to allow internal/self-signed CAs.',
        }
      }
      return {
        message: code ? `network error reaching NetBox (${code})` : 'network error reaching NetBox',
        hint: 'Check NETBOX_URL and that NetBox is reachable from this host.',
      }
  }
}

/**
 * Verify the configured NetBox is reachable, authenticated, and serving GraphQL.
 * Resolves with the version + NAPALM availability, or throws ConnectionCheckError
 * with a hint pointing at the likely misconfiguration. `fetchImpl` is injectable
 * for testing.
 */
export async function verifyConnection(
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionInfo> {
  const headers = { Authorization: `Token ${token}`, Accept: 'application/json' }

  // 1. REST /api/status/ — proves the URL resolves and the token is accepted.
  let statusRes: Response
  try {
    statusRes = await fetchImpl(`${baseUrl}/api/status/`, { headers })
  } catch (err) {
    const { message, hint } = networkFailure(err)
    throw new ConnectionCheckError(message, hint)
  }
  if (statusRes.status === 401 || statusRes.status === 403) {
    throw new ConnectionCheckError(
      `NetBox rejected the token (HTTP ${statusRes.status})`,
      'Check NETBOX_TOKEN and that it has read access.',
    )
  }
  if (!statusRes.ok) {
    throw new ConnectionCheckError(
      `NetBox /api/status/ returned HTTP ${statusRes.status}`,
      'Is NETBOX_URL the base URL of a NetBox instance (no trailing /api)?',
    )
  }
  const status = (await statusRes.json()) as {
    'netbox-version'?: string
    plugins?: Record<string, unknown>
  }

  // 2. GraphQL ping — the whole app is built on the GraphQL API, which can be
  // disabled independently of REST. Catch that here rather than as a blank UI.
  let gqlRes: Response
  try {
    gqlRes = await fetchImpl(`${baseUrl}/graphql/`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
    })
  } catch (err) {
    const { message, hint } = networkFailure(err)
    throw new ConnectionCheckError(`GraphQL ping failed: ${message}`, hint)
  }
  if (!gqlRes.ok) {
    throw new ConnectionCheckError(
      `NetBox GraphQL returned HTTP ${gqlRes.status}`,
      'Ensure the GraphQL API is enabled in NetBox (it is on by default).',
    )
  }

  return {
    version: status['netbox-version'] ?? null,
    napalmAvailable: Object.keys(status.plugins ?? {}).some((p) => p.includes('napalm')),
  }
}
