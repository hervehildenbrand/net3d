/** Persisted open/collapsed state for the left sites menu. */

const STORAGE_KEY = 'net3d-sites-menu-open'

/** Read the persisted menu state; defaults to open when unset/invalid. */
export function loadSitesMenuOpen(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true
    return localStorage.getItem(STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

/** Persist the menu state (best-effort; ignores storage failures). */
export function saveSitesMenuOpen(open: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, String(open))
  } catch {
    /* ignore (private mode / disabled storage) */
  }
}
