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

/** In-memory TTL cache. Single-process; swap for redis if the app ever scales out. */
export class TtlCache {
  private store = new Map<string, Entry>()
  private refreshing = new Set<string>()

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

  set(key: string, value: unknown, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
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
