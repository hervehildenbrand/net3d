import type { DiskCacheStore } from './persistence'

interface Entry {
  value: unknown
  expiresAt: number
}

export interface GetOrSetOptions {
  /**
   * Serve an expired entry immediately and refresh it in the background.
   * Entries are kept past expiry; a failed refresh keeps the stale value.
   */
  staleWhileRevalidate?: boolean
}

export interface TtlCacheOptions {
  /** When set, entries are written through to disk and can be hydrated on boot. */
  persist?: DiskCacheStore
  /** Which keys to persist (default: all). Used to skip volatile keys like napalm. */
  shouldPersist?: (key: string) => boolean
}

/** In-memory TTL cache. Single-process; swap for redis if the app ever scales out. */
export class TtlCache {
  private store = new Map<string, Entry>()
  private refreshing = new Set<string>()
  private readonly persist?: DiskCacheStore
  private readonly shouldPersist: (key: string) => boolean

  constructor(opts?: TtlCacheOptions) {
    this.persist = opts?.persist
    this.shouldPersist = opts?.shouldPersist ?? (() => true)
  }

  /**
   * Load persisted entries into memory at startup, keeping their original
   * expiry. After a restart that expiry is in the past, so SWR routes serve
   * the value instantly and revalidate it in the background.
   */
  hydrate(): void {
    if (!this.persist) return
    for (const { key, value, expiresAt } of this.persist.loadAllSync()) {
      this.store.set(key, { value, expiresAt })
    }
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    return entry.value as T
  }

  /** Like get(), but returns expired entries instead of evicting them. */
  private getStale<T>(key: string): { value: T; fresh: boolean } | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    return { value: entry.value as T, fresh: Date.now() <= entry.expiresAt }
  }

  /**
   * Read a value without enforcing its TTL or triggering a refresh: returns the
   * stored value even when stale, and never evicts. For assembling a derived
   * view (e.g. the device index) from whatever the prewarm loop has warmed —
   * get()'s hard-TTL eviction would punch sites out of the result between
   * refreshes; staleness is acceptable for an index the prewarm keeps current.
   */
  peek<T>(key: string): T | undefined {
    return this.getStale<T>(key)?.value
  }

  set(key: string, value: unknown, ttlMs: number): void {
    const expiresAt = Date.now() + ttlMs
    this.store.set(key, { value, expiresAt })
    // write-through: fire-and-forget; persistence never blocks or breaks a request
    if (this.persist && this.shouldPersist(key)) void this.persist.write(key, value, expiresAt)
  }

  async getOrSet<T>(
    key: string,
    ttlMs: number,
    fn: () => Promise<T>,
    opts?: GetOrSetOptions,
  ): Promise<T> {
    if (opts?.staleWhileRevalidate) {
      const entry = this.getStale<T>(key)
      if (entry) {
        if (!entry.fresh && !this.refreshing.has(key)) {
          this.refreshing.add(key)
          void fn()
            .then((value) => this.set(key, value, ttlMs))
            .catch(() => {}) // stale value keeps serving; next stale hit retries
            .finally(() => this.refreshing.delete(key))
        }
        return entry.value
      }
    } else {
      const hit = this.get<T>(key)
      if (hit !== undefined) return hit
    }
    const value = await fn()
    this.set(key, value, ttlMs)
    return value
  }
}
