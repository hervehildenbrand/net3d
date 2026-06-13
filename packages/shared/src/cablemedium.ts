/** Physical transport medium of a cable, used to color-group links by type. */
export type CableMedium = 'fiber' | 'copper' | 'dac' | 'power' | 'other'

/**
 * Classify a NetBox cable `type` into a physical medium so cables can be
 * grouped by color when NetBox provides no explicit per-cable color.
 * Prefix-based and case-insensitive (e.g. "smf-os2" → fiber, "cat6a" → copper).
 */
export function cableMedium(type: string | null): CableMedium {
  if (!type) return 'other'
  const t = type.toLowerCase()
  if (/^(smf|mmf|os\d|om\d)/.test(t)) return 'fiber'
  if (/^cat/.test(t)) return 'copper'
  if (/^(dac|twinax|aoc)/.test(t)) return 'dac'
  if (/^power/.test(t)) return 'power'
  return 'other'
}
