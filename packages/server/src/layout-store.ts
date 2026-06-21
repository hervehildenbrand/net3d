import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SITE_LAYOUT_VERSION, type SiteLayout } from '@net3d/shared'

/**
 * Durable, per-site store for user-edited floor plans. Unlike DiskCacheStore
 * (a TTL write-through cache for upstream data), layouts are permanent user data:
 * no TTL, no eviction, one hand-editable pretty-printed JSON file per site,
 * keyed by site name. Backend-agnostic — a site's physical footprint is the same
 * whether the data comes from NetBox or Infrahub, so this is never keyed by SoT.
 */
export interface LayoutStore {
  /** The saved layout for a site, or null if none / corrupt / wrong version. */
  get(siteName: string): SiteLayout | null
  /** Persist a layout atomically; resolves once written. */
  put(siteName: string, layout: SiteLayout): Promise<SiteLayout>
  /** Site names that currently have a saved layout. */
  list(): string[]
  /** Remove a layout; resolves to whether it existed. */
  delete(siteName: string): Promise<boolean>
}

// encodeURIComponent keeps the mapping reversible (so list() can recover the real
// name) and filesystem-safe — it escapes '/', spaces and other hostile chars.
const fileName = (siteName: string): string => `${encodeURIComponent(siteName)}.json`

/** Defensive read-time validation: a corrupt or stale file must never be served. */
function asSiteLayout(parsed: unknown): SiteLayout | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const l = parsed as Partial<SiteLayout>
  if (l.version !== SITE_LAYOUT_VERSION) return null
  if (typeof l.updatedAt !== 'string') return null
  if (!Array.isArray(l.racks) || !Array.isArray(l.rooms)) return null
  if (l.floor !== null && typeof l.floor !== 'object') return null
  return l as SiteLayout
}

export function createLayoutStore(dir: string): LayoutStore {
  const fileFor = (siteName: string) => join(dir, fileName(siteName))

  return {
    get(siteName) {
      let raw: string
      try {
        raw = readFileSync(fileFor(siteName), 'utf8')
      } catch {
        return null // missing/unreadable
      }
      try {
        return asSiteLayout(JSON.parse(raw))
      } catch {
        return null // corrupt JSON
      }
    },

    async put(siteName, layout) {
      const target = fileFor(siteName)
      const tmp = `${target}.${randomUUID()}.tmp`
      const data = JSON.stringify(layout, null, 2) // pretty for hand-editing
      try {
        await mkdir(dir, { recursive: true })
        await writeFile(tmp, data, 'utf8')
        await rename(tmp, target) // atomic on POSIX
      } catch (err) {
        try {
          await unlink(tmp)
        } catch {
          // temp file may not exist; ignore
        }
        throw err
      }
      return layout
    },

    list() {
      let files: string[]
      try {
        files = readdirSync(dir)
      } catch {
        return [] // missing dir → nothing stored yet
      }
      const out: string[] = []
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        try {
          out.push(decodeURIComponent(f.slice(0, -'.json'.length)))
        } catch {
          // undecodable filename — skip
        }
      }
      return out
    },

    async delete(siteName) {
      try {
        await unlink(fileFor(siteName))
        return true
      } catch {
        return false
      }
    },
  }
}
