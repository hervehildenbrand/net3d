interface Entry {
  value: unknown
  expiresAt: number
}

/** In-memory TTL cache. Single-process; swap for redis if the app ever scales out. */
export class TtlCache {
  private store = new Map<string, Entry>()

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    return entry.value as T
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
  }

  async getOrSet<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key)
    if (hit !== undefined) return hit
    const value = await fn()
    this.set(key, value, ttlMs)
    return value
  }
}
