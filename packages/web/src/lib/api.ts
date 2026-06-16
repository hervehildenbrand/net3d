/** The two source-of-truth backends net3d can read from. */
export type Backend = 'netbox' | 'infrahub'

/**
 * API path prefix per backend. Each backend is served by its own server
 * instance behind a different prefix (vite proxy in dev, nginx in prod):
 * NetBox at `/api`, Infrahub at `/api-infrahub` (rewritten to `/api` upstream).
 * The UI switch flips which prefix the data hooks call.
 */
export const API_PREFIX: Record<Backend, string> = {
  netbox: '/api',
  infrahub: '/api-infrahub',
}

/** Build an API URL for `backend`. `path` is the route after `/api`, e.g. `/sites`. */
export function apiUrl(backend: Backend, path: string): string {
  return `${API_PREFIX[backend]}${path}`
}
