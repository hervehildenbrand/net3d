import { describe, expect, test } from 'vitest'
import type { CableLive, LiveIface } from '@net3d/shared'
import { theme } from '../theme'
import { bundleColor, formatPct, groupLive, ifaceLive, liveColor, utilColor, utilT } from './liveTelemetry'

describe('utilT', () => {
  test('test_utilColor_log_anchors_low_mid_high', () => {
    // log10(0.01) = -2, so utilT = (-2 + 2) / 4 = 0
    expect(utilT(0.01)).toBeCloseTo(0, 6)
    // log10(1) = 0, so utilT = (0 + 2) / 4 = 0.5
    expect(utilT(1)).toBeCloseTo(0.5, 6)
    // log10(100) = 2, so utilT = (2 + 2) / 4 = 1
    expect(utilT(100)).toBeCloseTo(1, 6)
  })

  test('test_utilColor_zero_returns_low', () => {
    expect(utilT(0)).toBe(0)
    expect(utilColor(0)).toBe(theme.heatmap.low)
  })

  test('test_utilColor_monotonic_across_decades', () => {
    const vals = [0.01, 0.1, 1, 10, 100]
    const ts = vals.map(utilT)
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i]).toBeGreaterThan(ts[i - 1]!)
    }
  })
})

describe('formatPct', () => {
  test('test_formatPct_precision_by_magnitude', () => {
    expect(formatPct(0)).toBe('0')
    expect(formatPct(0.003)).toBe('<0.01')
    expect(formatPct(0.01)).toBe('0.01')
    expect(formatPct(0.996)).toBe('1.0')
    expect(formatPct(9.96)).toBe('10')
    expect(formatPct(12.3)).toBe('12')
    expect(formatPct(99.5)).toBe('100')
  })
})

describe('utilColor', () => {
  test('test_utilColor_over_hundred_clamps_to_heatmap_high', () => {
    const c = utilColor(130)
    expect(c).toBe(theme.heatmap.high)
    expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('liveColor', () => {
  test.each<[string, CableLive, string]>([
    ['stale_wins_over_pct_returns_noData', { pct: 70, bps: 7e9, stale: true }, theme.heatmap.noData],
    ['pct_null_not_stale_returns_cable_up', { pct: null, bps: null, stale: false }, theme.cable.up],
    ['pct_present_returns_utilColor', { pct: 40, bps: 4e9, stale: false }, utilColor(40)],
  ])('test_liveColor_%s', (_name, live, expected) => {
    expect(liveColor(live)).toBe(expected)
  })
})

describe('bundleColor', () => {
  test('test_bundleColor_max_member_pct_used', () => {
    const live = new Map<string, CableLive>([
      ['a', { pct: 30, bps: 3e9, stale: false }],
      ['b', { pct: 70, bps: 7e9, stale: false }],
    ])
    expect(bundleColor(['a', 'b'], live)).toBe(utilColor(70))
  })

  test('test_bundleColor_only_stale_members_returns_noData', () => {
    const live = new Map<string, CableLive>([
      ['a', { pct: null, bps: null, stale: true }],
      ['b', { pct: null, bps: null, stale: true }],
    ])
    expect(bundleColor(['a', 'b'], live)).toBe(theme.heatmap.noData)
  })

  test('test_bundleColor_no_member_in_map_returns_null', () => {
    const live = new Map<string, CableLive>()
    expect(bundleColor(['a', 'b'], live)).toBeNull()
  })

  test('test_bundleColor_live_without_pct_returns_cable_up', () => {
    const live = new Map<string, CableLive>([
      ['a', { pct: null, bps: null, stale: false }],
      ['b', { pct: null, bps: null, stale: false }],
    ])
    expect(bundleColor(['a', 'b'], live)).toBe(theme.cable.up)
  })

  test('test_bundleColor_stale_member_pct_excluded_from_max', () => {
    // a is stale but still carries a lingering pct (a third-party collector could send this);
    // the busiest *live* member (b, 20%) must win, not the stale one (90%).
    const live = new Map<string, CableLive>([
      ['a', { pct: 90, bps: 9e9, stale: true }],
      ['b', { pct: 20, bps: 2e9, stale: false }],
    ])
    expect(bundleColor(['a', 'b'], live)).toBe(utilColor(20))
  })
})

describe('ifaceLive', () => {
  test('test_ifaceLive_undefined_returns_null', () => {
    expect(ifaceLive(undefined)).toBeNull()
  })

  test('test_ifaceLive_stale_returns_noData_text', () => {
    const iface: LiveIface = { rxBps: 1, txBps: 1, capacityBps: 100, stale: true }
    expect(ifaceLive(iface)).toEqual({ text: 'stale', color: theme.heatmap.noData })
  })

  test('test_ifaceLive_both_rates_null_returns_null', () => {
    const iface: LiveIface = { rxBps: null, txBps: null, capacityBps: 100, stale: false }
    expect(ifaceLive(iface)).toBeNull()
  })

  test('test_ifaceLive_with_capacity_shows_percent_and_utilColor', () => {
    const iface: LiveIface = { rxBps: 1.5e6, txBps: 12.3e9, capacityBps: 100e9, stale: false }
    // 12.3% → formatPct → '12' (rounds down to integer for >= 10)
    expect(ifaceLive(iface)).toEqual({ text: '↓1.5 Mbps ↑12.3 Gbps 12%', color: utilColor(12.3) })
  })

  test('test_ifaceLive_without_capacity_omits_percent_and_uses_cable_up', () => {
    const iface: LiveIface = { rxBps: 1.5e6, txBps: 12.3e9, capacityBps: null, stale: false }
    expect(ifaceLive(iface)).toEqual({ text: '↓1.5 Mbps ↑12.3 Gbps', color: theme.cable.up })
  })

  test('test_ifaceLive_one_direction_null_defaults_to_zero', () => {
    const iface: LiveIface = { rxBps: null, txBps: 1e6, capacityBps: null, stale: false }
    expect(ifaceLive(iface)).toEqual({ text: '↓0 bps ↑1 Mbps', color: theme.cable.up })
  })

  test('test_ifaceLive_sub_one_percent_not_coloured_as_zero', () => {
    // 0.5% should use the log scale, not the same color as 0%
    const iface: LiveIface = { rxBps: 0, txBps: 5e7, capacityBps: 10e9, stale: false }
    const result = ifaceLive(iface)!
    expect(result.color).not.toBe(theme.heatmap.low) // not same as 0%
    expect(result.color).toBe(utilColor(0.5))
    expect(result.text).toMatch(/0\.50%$/)
  })
})

describe('groupLive', () => {
  test('test_groupLive_busiest_colour_and_fresh_bps_sum', () => {
    const live = new Map<string, CableLive>([
      ['a', { pct: 30, bps: 3e9, stale: false }],
      ['b', { pct: 70, bps: 7e9, stale: false }],
      ['c', { pct: 10, bps: 1e9, stale: false }],
    ])
    const result = groupLive(['a', 'b', 'c'], live)!
    expect(result.color).toBe(utilColor(70))
    expect(result.bps).toBe(11e9) // 3 + 7 + 1
  })

  test('test_groupLive_no_member_returns_null', () => {
    const live = new Map<string, CableLive>()
    expect(groupLive(['a', 'b'], live)).toBeNull()
  })

  test('test_groupLive_all_stale_has_null_bps', () => {
    // All stale with null pct → noData color; bps null since stale members don't contribute
    const live = new Map<string, CableLive>([
      ['a', { pct: null, bps: null, stale: true }],
      ['b', { pct: null, bps: null, stale: true }],
    ])
    const result = groupLive(['a', 'b'], live)!
    expect(result.color).toBe(theme.heatmap.noData)
    expect(result.bps).toBeNull()
  })
})
