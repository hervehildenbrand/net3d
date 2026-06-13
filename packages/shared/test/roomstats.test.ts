import { describe, expect, test } from 'vitest'
import { computeRoomStats } from '../src/roomstats'

const rack = (location: string | null, statuses: string[]) => ({
  location,
  devices: statuses.map((status, i) => ({ status, id: String(i) })),
})

describe('computeRoomStats', () => {
  test('aggregates rack and device counts per location', () => {
    const stats = computeRoomStats([
      rack('hall-1', ['active', 'active', 'offline']),
      rack('hall-1', ['active']),
      rack('network-core', ['active', 'planned']),
    ])
    expect(stats).toEqual([
      { location: 'hall-1', rackCount: 2, deviceCount: 4, activeDeviceCount: 3 },
      { location: 'network-core', rackCount: 1, deviceCount: 2, activeDeviceCount: 1 },
    ])
  })

  test('null locations group under empty string', () => {
    const stats = computeRoomStats([rack(null, ['active'])])
    expect(stats).toEqual([{ location: '', rackCount: 1, deviceCount: 1, activeDeviceCount: 1 }])
  })

  test('empty input yields empty stats', () => {
    expect(computeRoomStats([])).toEqual([])
  })
})
