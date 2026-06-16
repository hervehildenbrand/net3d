import { describe, expect, test } from 'vitest'
import type { SiteDevice, SiteRack } from '../hooks/useSiteDetail'
import { theme } from '../theme'
import { availableMetrics, computeSpecsRange, rackAggregate, specsColor } from './specsHeatmap'

function dev(overrides: Partial<SiteDevice> = {}): SiteDevice {
  return {
    id: 'd1',
    name: 'dev',
    position: 1,
    face: 'FRONT',
    roleName: 'server',
    roleColor: '00ff88',
    uHeight: 1,
    model: 'm',
    manufacturer: 'mf',
    isFullDepth: true,
    status: 'active',
    ...overrides,
  }
}

function rack(id: string, devices: SiteDevice[]): SiteRack {
  return { id, name: id.toUpperCase(), uHeight: 42, location: null, devices }
}

describe('availableMetrics', () => {
  test('returns [] when no device carries any spec', () => {
    expect(availableMetrics([rack('r1', [dev(), dev()])])).toEqual([])
  })

  test('lists only metrics with at least one populated value, in canonical order', () => {
    const racks = [
      rack('r1', [dev({ specs: { storageTb: 4 } }), dev({ specs: { cpuCores: 32 } })]),
    ]
    // canonical order is cpuCores, ramGb, storageTb — ramGb absent, so omitted
    expect(availableMetrics(racks)).toEqual(['cpuCores', 'storageTb'])
  })

  test('ignores cpuModel (non-numeric) and treats 0 as a real value', () => {
    const racks = [rack('r1', [dev({ specs: { cpuModel: 'Xeon', cpuCores: 0 } })])]
    expect(availableMetrics(racks)).toEqual(['cpuCores'])
  })
})

describe('computeSpecsRange', () => {
  test('returns {0,0} when no device has the metric', () => {
    expect(computeSpecsRange([rack('r1', [dev()])], 'ramGb')).toEqual({ min: 0, max: 0 })
  })

  test('spans the min and max across all racks', () => {
    const racks = [
      rack('r1', [dev({ specs: { ramGb: 64 } }), dev({ specs: { ramGb: 256 } })]),
      rack('r2', [dev({ specs: { ramGb: 128 } })]),
    ]
    expect(computeSpecsRange(racks, 'ramGb')).toEqual({ min: 64, max: 256 })
  })

  test('skips devices missing the metric without breaking the range', () => {
    const racks = [rack('r1', [dev({ specs: { cpuCores: 16 } }), dev(), dev({ specs: { cpuCores: 48 } })])]
    expect(computeSpecsRange(racks, 'cpuCores')).toEqual({ min: 16, max: 48 })
  })
})

describe('specsColor', () => {
  test('undefined value reads as the no-data color', () => {
    expect(specsColor(undefined, 0, 100)).toBe(theme.heatmap.noData)
  })

  test('min maps to the low stop, max to the high stop, midpoint to the mid stop', () => {
    expect(specsColor(0, 0, 100)).toBe(theme.heatmap.low)
    expect(specsColor(100, 0, 100)).toBe(theme.heatmap.high)
    expect(specsColor(50, 0, 100)).toBe(theme.heatmap.mid)
  })

  test('a flat range (min === max) reads as the mid stop, not low', () => {
    expect(specsColor(128, 128, 128)).toBe(theme.heatmap.mid)
  })
})

describe('rackAggregate', () => {
  test('undefined when no device in the rack has the metric', () => {
    expect(rackAggregate(rack('r1', [dev()]), 'storageTb')).toBeUndefined()
  })

  test('defaults to the max value across the rack', () => {
    const r = rack('r1', [dev({ specs: { cpuCores: 16 } }), dev({ specs: { cpuCores: 64 } })])
    expect(rackAggregate(r, 'cpuCores')).toBe(64)
  })

  test('computes the mean when asked', () => {
    const r = rack('r1', [dev({ specs: { ramGb: 64 } }), dev({ specs: { ramGb: 192 } })])
    expect(rackAggregate(r, 'ramGb', 'mean')).toBe(128)
  })
})
