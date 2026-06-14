import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * On-disk NetBox cache: write-through persistence so the in-memory TtlCache
 * survives a server restart (tsx watch re-exec, branch switch). Site details
 * cost 30-75s to cold-fetch; persisting them turns a post-restart click from a
 * minute-long "loading racks…" hang into an instant stale serve + SWR refresh.
 *
 * Bump CACHE_VERSION whenever the persisted value shape changes — older records
 * are then discarded on load instead of being served as garbage.
 */
export const CACHE_VERSION = 1

/** Canonical form so trailing slashes / host casing don't fork the cache dir. */
function normalize(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return url.trim().replace(/\/+$/, '')
  }
}

/** Stable per-instance directory name; isolates showcase (:8088) from live (.env). */
export function hashNetboxUrl(url: string): string {
  return createHash('sha256').update(normalize(url)).digest('hex').slice(0, 16)
}

interface PersistedRecord {
  cacheVersion: number
  netboxUrl: string
  key: string
  expiresAt: number
  value: unknown
}

export interface CacheEntry {
  key: string
  value: unknown
  expiresAt: number
}

export interface DiskCacheStore {
  /** Write-through one entry. Best-effort and atomic; never rejects. */
  write(key: string, value: unknown, expiresAt: number): Promise<void>
  /** Synchronously read every valid entry for this instance (for boot hydration). */
  loadAllSync(): CacheEntry[]
  /** Resolve once all in-flight writes have landed (test/shutdown determinism). */
  flush(): Promise<void>
}

export function createDiskCacheStore({
  baseDir,
  netboxUrl,
}: {
  baseDir: string
  netboxUrl: string
}): DiskCacheStore {
  const normalizedUrl = normalize(netboxUrl)
  const dir = join(baseDir, hashNetboxUrl(netboxUrl))
  const inFlight = new Set<Promise<void>>()

  // Hash the key so filesystem-hostile characters (the ':' in "site:AMS1") and
  // length limits never matter; the real key lives inside the record.
  const fileFor = (key: string) =>
    join(dir, `${createHash('sha256').update(key).digest('hex').slice(0, 16)}.json`)

  async function writeImpl(key: string, value: unknown, expiresAt: number): Promise<void> {
    let data: string
    try {
      data = JSON.stringify({
        cacheVersion: CACHE_VERSION,
        netboxUrl: normalizedUrl,
        key,
        expiresAt,
        value,
      } satisfies PersistedRecord)
    } catch {
      return // unserializable value — drop it rather than crash a request
    }
    const target = fileFor(key)
    const tmp = `${target}.${randomUUID()}.tmp`
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(tmp, data, 'utf8')
      await rename(tmp, target) // atomic on POSIX; concurrent writers are last-wins
    } catch {
      try {
        await unlink(tmp)
      } catch {
        // temp file may not exist; ignore
      }
    }
  }

  return {
    write(key, value, expiresAt) {
      const p = writeImpl(key, value, expiresAt).finally(() => inFlight.delete(p))
      inFlight.add(p)
      return p
    },

    async flush() {
      await Promise.all([...inFlight])
    },

    loadAllSync() {
      let files: string[]
      try {
        files = readdirSync(dir)
      } catch {
        return [] // missing/unreadable dir → empty cache
      }
      const out: CacheEntry[] = []
      for (const file of files) {
        if (!file.endsWith('.json')) continue // skip .tmp orphans and stray files
        try {
          const rec = JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown
          if (typeof rec !== 'object' || rec === null) continue
          const r = rec as Partial<PersistedRecord>
          if (r.cacheVersion !== CACHE_VERSION) continue // stale shape — discard
          if (r.netboxUrl !== normalizedUrl) continue // foreign instance — discard
          if (typeof r.key !== 'string') continue
          if (typeof r.expiresAt !== 'number') continue
          out.push({ key: r.key, value: r.value, expiresAt: r.expiresAt })
        } catch {
          // corrupt/partial/unreadable file — skip, never break boot
        }
      }
      return out
    },
  }
}
