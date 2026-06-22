import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  areaLabel,
  formatArea,
  formatLength,
  fromMeters,
  loadUnitPreference,
  METERS_PER_FOOT,
  saveUnitPreference,
  toMeters,
  unitLabel,
} from './units'

describe('fromMeters', () => {
  test('returns meters unchanged for unit "m"', () => {
    expect(fromMeters(3.5, 'm')).toBeCloseTo(3.5, 10)
  })

  test('converts meters to feet for unit "ft"', () => {
    expect(fromMeters(1, 'ft')).toBeCloseTo(1 / METERS_PER_FOOT, 6) // ~3.28084
  })

  test('handles zero', () => {
    expect(fromMeters(0, 'ft')).toBe(0)
  })
})

describe('toMeters', () => {
  test('returns meters unchanged for unit "m"', () => {
    expect(toMeters(3.5, 'm')).toBeCloseTo(3.5, 10)
  })

  test('converts feet to meters', () => {
    expect(toMeters(1, 'ft')).toBeCloseTo(0.3048, 10)
  })

  test('round-trips a meter value exactly through feet', () => {
    const original = 2.345
    expect(toMeters(fromMeters(original, 'ft'), 'ft')).toBeCloseTo(original, 10)
  })
})

describe('formatLength', () => {
  test('formats meters with two decimals and a suffix', () => {
    expect(formatLength(2.5, 'm')).toBe('2.50 m')
  })

  test('formats feet (converted) with a suffix', () => {
    expect(formatLength(1, 'ft')).toBe('3.28 ft')
  })

  test('respects an explicit decimals argument', () => {
    expect(formatLength(2.5, 'm', 1)).toBe('2.5 m')
  })
})

describe('formatArea', () => {
  test('formats square meters with one decimal', () => {
    expect(formatArea(96, 'm')).toBe('96.0 m²')
  })

  test('converts square meters to square feet', () => {
    // 1 m² = 10.7639 ft²
    expect(formatArea(1, 'ft')).toBe('10.8 ft²')
  })
})

describe('labels', () => {
  test('unitLabel', () => {
    expect(unitLabel('m')).toBe('m')
    expect(unitLabel('ft')).toBe('ft')
  })

  test('areaLabel', () => {
    expect(areaLabel('m')).toBe('m²')
    expect(areaLabel('ft')).toBe('ft²')
  })
})

describe('preference persistence', () => {
  const store: Record<string, string> = {}
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => (k in store ? store[k]! : null),
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k]
      },
      key: () => null,
      length: 0,
    } as Storage
  })
  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage
  })

  test('loadUnitPreference defaults to meters', () => {
    expect(loadUnitPreference()).toBe('m')
  })

  test('saveUnitPreference persists and loadUnitPreference reads it back', () => {
    saveUnitPreference('ft')
    expect(loadUnitPreference()).toBe('ft')
  })

  test('an unrecognized stored value falls back to meters', () => {
    saveUnitPreference('ft')
    store['net3d-length-unit'] = 'parsecs'
    expect(loadUnitPreference()).toBe('m')
  })
})
