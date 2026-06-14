import { describe, expect, test } from 'vitest'
import { normalizeRawPower, type RawSitePower } from '../src/power'

const raw = (over: Partial<RawSitePower> = {}): RawSitePower => ({
  power_panel_list: [{ id: '1', name: 'AMS1-PWR-A', location: { name: 'network-core' } }],
  power_feed_list: [
    {
      id: '10',
      name: 'AMS1-NET-01-feed-A',
      status: 'active',
      voltage: 415,
      amperage: 32,
      phase: 'three-phase',
      supply: 'ac',
      type: 'primary',
      max_utilization: 80,
      power_panel: { name: 'AMS1-PWR-A' },
      rack: { name: 'AMS1-NET-01' },
    },
  ],
  ...over,
})

describe('normalizeRawPower', () => {
  test('maps panels with their location name', () => {
    const { panels } = normalizeRawPower(raw())
    expect(panels).toEqual([{ id: '1', name: 'AMS1-PWR-A', location: 'network-core' }])
  })

  test('maps feed electrical + rack/panel relations', () => {
    const { feeds } = normalizeRawPower(raw())
    expect(feeds[0]).toEqual({
      id: '10',
      name: 'AMS1-NET-01-feed-A',
      status: 'active',
      voltage: 415,
      amperage: 32,
      phase: 'three-phase',
      supply: 'ac',
      type: 'primary',
      maxUtilization: 80,
      panelName: 'AMS1-PWR-A',
      rackName: 'AMS1-NET-01',
    })
  })

  test('lowercases feed status (NetBox 4.x returns mixed case)', () => {
    const { feeds } = normalizeRawPower(
      raw({ power_feed_list: [{ ...raw().power_feed_list[0]!, status: 'ACTIVE' }] }),
    )
    expect(feeds[0]!.status).toBe('active')
  })

  test('null relations and missing electricals degrade to null', () => {
    const { panels, feeds } = normalizeRawPower(
      raw({
        power_panel_list: [{ id: '2', name: 'p', location: null }],
        power_feed_list: [
          {
            id: '11',
            name: 'f',
            status: 'active',
            voltage: null,
            amperage: null,
            phase: null,
            supply: null,
            type: null,
            max_utilization: null,
            power_panel: null,
            rack: null,
          },
        ],
      }),
    )
    expect(panels[0]!.location).toBeNull()
    expect(feeds[0]).toMatchObject({
      voltage: null,
      amperage: null,
      phase: null,
      panelName: null,
      rackName: null,
    })
  })

  test('handles empty lists', () => {
    expect(normalizeRawPower({ power_panel_list: [], power_feed_list: [] })).toEqual({
      panels: [],
      feeds: [],
    })
  })
})
