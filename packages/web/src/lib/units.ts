/**
 * Length-unit display helpers for the floor-plan editor. The data model is
 * meters-native (1:1 world scale); these convert/format for display and let the
 * user read/enter values in meters or feet. Storage stays in meters — only the
 * display layer ever sees feet, so there is no precision loss on round-trips.
 */

export type LengthUnit = 'm' | 'ft'

/** Meters per foot (exact international definition). */
export const METERS_PER_FOOT = 0.3048

const UNIT_STORAGE_KEY = 'net3d-length-unit'

/** Meters → the given display unit. Never rounds (exact inverse of toMeters). */
export function fromMeters(meters: number, unit: LengthUnit): number {
  return unit === 'ft' ? meters / METERS_PER_FOOT : meters
}

/** A display value in the given unit → meters. Never rounds. */
export function toMeters(value: number, unit: LengthUnit): number {
  return unit === 'ft' ? value * METERS_PER_FOOT : value
}

/** Unit suffix for a length, e.g. "m" or "ft". */
export function unitLabel(unit: LengthUnit): string {
  return unit
}

/** Unit suffix for an area, e.g. "m²" or "ft²". */
export function areaLabel(unit: LengthUnit): string {
  return unit === 'ft' ? 'ft²' : 'm²'
}

/** Format a length (stored in meters) for display, e.g. "12.00 m" / "39.37 ft". */
export function formatLength(meters: number, unit: LengthUnit, decimals = 2): string {
  return `${fromMeters(meters, unit).toFixed(decimals)} ${unitLabel(unit)}`
}

/** Format an area (stored in m²) for display, e.g. "96.0 m²" / "1033.3 ft²". */
export function formatArea(sqMeters: number, unit: LengthUnit, decimals = 1): string {
  const value = unit === 'ft' ? sqMeters / (METERS_PER_FOOT * METERS_PER_FOOT) : sqMeters
  return `${value.toFixed(decimals)} ${areaLabel(unit)}`
}

/** Read the persisted unit preference; defaults to meters when unset/invalid. */
export function loadUnitPreference(): LengthUnit {
  try {
    if (typeof localStorage === 'undefined') return 'm'
    return localStorage.getItem(UNIT_STORAGE_KEY) === 'ft' ? 'ft' : 'm'
  } catch {
    return 'm'
  }
}

/** Persist the unit preference (best-effort; ignores storage failures). */
export function saveUnitPreference(unit: LengthUnit): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(UNIT_STORAGE_KEY, unit)
  } catch {
    /* ignore (private mode / disabled storage) */
  }
}
