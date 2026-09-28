import { describe, expect, test } from 'vitest'
import { circuitDirections, circuitEnds, circuitLinks, mapInterfacesToCables, mapTelemetryToCables } from '../src/livestatus'
import type { SiteTelemetry } from '../src/livestatus'

const cables = [
  {
    id: 'c1',
    a: { deviceName: 'rt1', name: 'et-0/0/0' },
    b: { deviceName: 'sw1', name: 'xe-0/0/5' },
  },
  {
    id: 'c2',
    a: { deviceName: 'sw1', name: 'ge-0/0/1' },
    b: { deviceName: 'rt1', name: 'et-0/0/1' },
  },
  { id: 'c3', a: { deviceName: 'other', name: 'eth0' }, b: null },
]

describe('mapInterfacesToCables', () => {
  test('marks cable up/down from the device interface state, either side', () => {
    const m = mapInterfacesToCables(
      { 'et-0/0/0': { is_up: true }, 'et-0/0/1': { is_up: false } },
      cables,
      'rt1',
    )
    expect(m.get('c1')).toBe('up')
    expect(m.get('c2')).toBe('down')
  })

  test('ignores cables not touching the device or with unknown interfaces', () => {
    const m = mapInterfacesToCables({ 'et-0/0/9': { is_up: true } }, cables, 'rt1')
    expect(m.size).toBe(0)
  })

  test('falls back to the base interface name when only a subinterface matches', () => {
    const m = mapInterfacesToCables({ 'et-0/0/0.0': { is_up: true } }, cables, 'rt1')
    expect(m.get('c1')).toBe('up')
  })
})

describe('mapTelemetryToCables', () => {
  test('test_mapTelemetryToCables_both_ends_live_uses_tx_per_side_and_min_capacity', () => {
    const telemetry: SiteTelemetry = {
      devices: {
        rt1: { 'et-0/0/0': { txBps: 30e9, rxBps: 12e9, capacityBps: 100e9, stale: false } },
        sw1: { 'xe-0/0/5': { txBps: 12e9, rxBps: 30e9, capacityBps: 40e9, stale: false } },
      },
    }
    const m = mapTelemetryToCables(telemetry, [
      { id: 'c1', a: { deviceName: 'rt1', name: 'et-0/0/0' }, b: { deviceName: 'sw1', name: 'xe-0/0/5' } },
    ])
    expect(m.get('c1')).toEqual({ pct: 75, bps: 30e9, stale: false })
  })

  test('test_mapTelemetryToCables_only_a_monitored_uses_a_tx_and_rx', () => {
    const telemetry: SiteTelemetry = {
      devices: { rt1: { 'et-0/0/0': { txBps: 8e9, rxBps: 2e9, capacityBps: 10e9, stale: false } } },
    }
    const m = mapTelemetryToCables(telemetry, [
      { id: 'c1', a: { deviceName: 'rt1', name: 'et-0/0/0' }, b: { deviceName: 'sw1', name: 'xe-0/0/5' } },
    ])
    expect(m.get('c1')).toEqual({ pct: 80, bps: 8e9, stale: false })
  })

  test('test_mapTelemetryToCables_only_b_monitored_uses_b_rx_and_tx', () => {
    const telemetry: SiteTelemetry = {
      devices: { sw1: { 'xe-0/0/5': { rxBps: 5e9, txBps: 1e9, capacityBps: 10e9, stale: false } } },
    }
    const m = mapTelemetryToCables(telemetry, [
      { id: 'c1', a: { deviceName: 'rt1', name: 'et-0/0/0' }, b: { deviceName: 'sw1', name: 'xe-0/0/5' } },
    ])
    expect(m.get('c1')).toEqual({ pct: 50, bps: 5e9, stale: false })
  })

  test('test_mapTelemetryToCables_null_tx_falls_back_to_peer_rx', () => {
    const telemetry: SiteTelemetry = {
      devices: {
        rt1: { 'et-0/0/0': { txBps: null, rxBps: 1e9, capacityBps: 10e9, stale: false } },
        sw1: { 'xe-0/0/5': { txBps: 1e9, rxBps: 9e9, capacityBps: 10e9, stale: false } },
      },
    }
    const m = mapTelemetryToCables(telemetry, [
      { id: 'c1', a: { deviceName: 'rt1', name: 'et-0/0/0' }, b: { deviceName: 'sw1', name: 'xe-0/0/5' } },
    ])
    expect(m.get('c1')).toEqual({ pct: 90, bps: 9e9, stale: false })
  })

  test('test_mapTelemetryToCables_stale_end_ignored_uses_live_end', () => {
    const telemetry: SiteTelemetry = {
      devices: {
        rt1: { 'et-0/0/0': { txBps: null, rxBps: null, capacityBps: null, stale: true } },
        sw1: { 'xe-0/0/5': { rxBps: 3e9, txBps: 1e9, capacityBps: 10e9, stale: false } },
      },
    }
    const m = mapTelemetryToCables(telemetry, [
      { id: 'c1', a: { deviceName: 'rt1', name: 'et-0/0/0' }, b: { deviceName: 'sw1', name: 'xe-0/0/5' } },
    ])
    expect(m.get('c1')).toEqual({ pct: 30, bps: 3e9, stale: false })
  })

  test('test_mapTelemetryToCables_all_known_ends_stale_marks_stale', () => {
    const telemetry: SiteTelemetry = {
      devices: {
        rt1: { 'et-0/0/0': { txBps: null, rxBps: null, capacityBps: null, stale: true } },
        sw1: { 'xe-0/0/5': { txBps: null, rxBps: null, capacityBps: null, stale: true } },
      },
    }
    const m = mapTelemetryToCables(telemetry, [
      { id: 'c1', a: { deviceName: 'rt1', name: 'et-0/0/0' }, b: { deviceName: 'sw1', name: 'xe-0/0/5' } },
    ])
    expect(m.get('c1')).toEqual({ pct: null, bps: null, stale: true })
  })

  test('test_mapTelemetryToCables_unknown_capacity_gives_null_pct', () => {
    const telemetry: SiteTelemetry = {
      devices: {
        rt1: { 'et-0/0/0': { txBps: 5e9, rxBps: 1e9, capacityBps: null, stale: false } },
        sw1: { 'xe-0/0/5': { txBps: 2e9, rxBps: 8e9, capacityBps: null, stale: false } },
      },
    }
    const m = mapTelemetryToCables(telemetry, [
      { id: 'c1', a: { deviceName: 'rt1', name: 'et-0/0/0' }, b: { deviceName: 'sw1', name: 'xe-0/0/5' } },
    ])
    expect(m.get('c1')).toEqual({ pct: null, bps: 5e9, stale: false })
  })

  test('test_mapTelemetryToCables_unmonitored_or_initializing_cables_absent', () => {
    const telemetry: SiteTelemetry = {
      devices: { rt1: { 'et-0/0/0': { rxBps: null, txBps: null, capacityBps: 10e9, stale: false } } },
    }
    const m = mapTelemetryToCables(telemetry, [
      { id: 'null-sides', a: null, b: null },
      { id: 'null-device-name', a: { deviceName: null, name: 'et-0/0/0' }, b: null },
      { id: 'unknown-iface', a: { deviceName: 'rt1', name: 'unknown-iface' }, b: null },
      { id: 'initializing', a: { deviceName: 'rt1', name: 'et-0/0/0' }, b: null },
    ])
    expect(m.has('null-sides')).toBe(false)
    expect(m.has('null-device-name')).toBe(false)
    expect(m.has('unknown-iface')).toBe(false)
    expect(m.has('initializing')).toBe(false)
  })

  test('test_mapTelemetryToCables_reports_peak_direction_bps', () => {
    const telemetry: SiteTelemetry = {
      devices: {
        rt1: { 'et-0/0/0': { txBps: 30e9, rxBps: 12e9, capacityBps: 100e9, stale: false } },
        sw1: { 'xe-0/0/5': { txBps: 12e9, rxBps: 30e9, capacityBps: 40e9, stale: false } },
      },
    }
    const m = mapTelemetryToCables(telemetry, [
      { id: 'c1', a: { deviceName: 'rt1', name: 'et-0/0/0' }, b: { deviceName: 'sw1', name: 'xe-0/0/5' } },
    ])
    // ab = rt1.tx = 30e9, ba = sw1.tx = 12e9 => bps = max(30e9, 12e9) = 30e9
    expect(m.get('c1')?.bps).toBe(30e9)
  })

  test('test_mapTelemetryToCables_null_rates_stale_has_null_bps', () => {
    const telemetry: SiteTelemetry = {
      devices: {
        rt1: { 'et-0/0/0': { txBps: null, rxBps: null, capacityBps: null, stale: true } },
        sw1: { 'xe-0/0/5': { txBps: null, rxBps: null, capacityBps: null, stale: true } },
      },
    }
    const m = mapTelemetryToCables(telemetry, [
      { id: 'c1', a: { deviceName: 'rt1', name: 'et-0/0/0' }, b: { deviceName: 'sw1', name: 'xe-0/0/5' } },
    ])
    expect(m.get('c1')).toEqual({ pct: null, stale: true, bps: null })
  })

  test('test_mapTelemetryToCables_cross_site_devices_uses_each_ends_tx', () => {
    // When both ends are monitored, ab = a.tx, ba = b.tx (each device's own outbound)
    const telemetry: SiteTelemetry = {
      devices: {
        rt1: { 'et-0/0/0': { txBps: 5e9, rxBps: 8e9, capacityBps: 10e9, stale: false } },
        rt2: { 'et-0/0/0': { txBps: 8e9, rxBps: 5e9, capacityBps: 10e9, stale: false } },
      },
    }
    const m = mapTelemetryToCables(telemetry, [
      { id: 'c1', a: { deviceName: 'rt1', name: 'et-0/0/0' }, b: { deviceName: 'rt2', name: 'et-0/0/0' } },
    ])
    // ab = rt1.tx = 5e9, ba = rt2.tx = 8e9 => bps = max(5e9, 8e9) = 8e9
    expect(m.get('c1')?.bps).toBe(8e9)
  })
})

describe('circuitLinks', () => {
  const mkCable = (
    id: string,
    a: { kind: string; name: string; deviceName: string } | null,
    b: { kind: string; name: string; deviceName: string } | null,
  ) => ({ id, a, b })

  test('test_circuitLinks_pairs_router_ends_from_two_sites', () => {
    // Two cables, each from a router to the same circuit "PAR1-AMS1"
    const cables = [
      mkCable('c1', { kind: 'device', name: 'et-0/0/0', deviceName: 'par1-rt1' }, { kind: 'circuit', name: 'PAR1-AMS1', deviceName: '' }),
      mkCable('c2', { kind: 'circuit', name: 'PAR1-AMS1', deviceName: '' }, { kind: 'device', name: 'et-0/0/0', deviceName: 'ams1-rt1' }),
    ]
    const links = circuitLinks(cables)
    expect(links).toHaveLength(1)
    expect(links[0]).toEqual({
      id: 'PAR1-AMS1',
      a: { deviceName: 'par1-rt1', name: 'et-0/0/0' },
      b: { deviceName: 'ams1-rt1', name: 'et-0/0/0' },
    })
  })

  test('test_circuitLinks_single_end_leaves_b_null', () => {
    const cables = [
      mkCable('c1', { kind: 'device', name: 'et-0/0/0', deviceName: 'par1-rt1' }, { kind: 'circuit', name: 'PAR1-AMS1', deviceName: '' }),
    ]
    const links = circuitLinks(cables)
    expect(links).toHaveLength(1)
    expect(links[0]).toEqual({
      id: 'PAR1-AMS1',
      a: { deviceName: 'par1-rt1', name: 'et-0/0/0' },
      b: null,
    })
  })

  test('test_circuitLinks_ignores_non_circuit_and_blank_cid', () => {
    const cables = [
      // Both ends device (normal cable, no circuit)
      mkCable('c1', { kind: 'device', name: 'et-0/0/0', deviceName: 'rt1' }, { kind: 'device', name: 'xe-0/0/0', deviceName: 'sw1' }),
      // Circuit end but blank name
      mkCable('c2', { kind: 'device', name: 'et-0/0/1', deviceName: 'rt1' }, { kind: 'circuit', name: '', deviceName: '' }),
      // Both ends circuit (malformed)
      mkCable('c3', { kind: 'circuit', name: 'CID1', deviceName: '' }, { kind: 'circuit', name: 'CID2', deviceName: '' }),
    ]
    const links = circuitLinks(cables)
    expect(links).toHaveLength(0)
  })

  test('test_circuitLinks_same_port_twice_is_deduped', () => {
    // Same device+port appearing twice for the same circuit (duplicate cables in data)
    const cables = [
      mkCable('c1', { kind: 'device', name: 'et-0/0/0', deviceName: 'rt1' }, { kind: 'circuit', name: 'CID1', deviceName: '' }),
      mkCable('c2', { kind: 'device', name: 'et-0/0/0', deviceName: 'rt1' }, { kind: 'circuit', name: 'CID1', deviceName: '' }),
    ]
    const links = circuitLinks(cables)
    expect(links).toHaveLength(1)
    expect(links[0]).toEqual({
      id: 'CID1',
      a: { deviceName: 'rt1', name: 'et-0/0/0' },
      b: null,
    })
  })

  test('test_circuitLinks_device_end_without_device_name_is_skipped', () => {
    // A device end with null deviceName (e.g. patch panel) should be skipped
    const cables = [
      // Device end has null deviceName — skip this cable for circuit linking
      { id: 'c1', a: { kind: 'device', name: 'port-1', deviceName: null }, b: { kind: 'circuit', name: 'CID1', deviceName: '' } },
      // Valid device end with deviceName
      { id: 'c2', a: { kind: 'device', name: 'et-0/0/0', deviceName: 'rt1' }, b: { kind: 'circuit', name: 'CID1', deviceName: '' } },
    ]
    const links = circuitLinks(cables as Parameters<typeof circuitLinks>[0])
    expect(links).toHaveLength(1)
    expect(links[0]).toEqual({
      id: 'CID1',
      a: { deviceName: 'rt1', name: 'et-0/0/0' },
      b: null,
    })
  })
})

describe('circuitEnds', () => {
  const dev = (deviceName: string, name = 'et-0/0/5') => ({ kind: 'device', name, deviceName })
  const cir = (cid: string) => ({ kind: 'circuit', name: cid, deviceName: null })

  test('test_circuitEnds_locates_each_end_by_the_site_whose_cables_reach_it', () => {
    const ends = circuitEnds([
      { site: 'ams1', cables: [{ a: cir('C1'), b: dev('r-ams') }] },
      { site: 'par1', cables: [{ a: dev('r-par'), b: cir('C1') }] },
    ])
    expect(ends).toEqual([
      { cid: 'C1', site: 'ams1', deviceName: 'r-ams', name: 'et-0/0/5' },
      { cid: 'C1', site: 'par1', deviceName: 'r-par', name: 'et-0/0/5' },
    ])
  })

  test('test_circuitEnds_keeps_first_port_per_circuit_and_site', () => {
    const ends = circuitEnds([
      { site: 'ams1', cables: [{ a: cir('C1'), b: dev('r-ams', 'et-0/0/5') }, { a: cir('C1'), b: dev('r-ams', 'et-0/0/6') }] },
    ])
    expect(ends).toEqual([{ cid: 'C1', site: 'ams1', deviceName: 'r-ams', name: 'et-0/0/5' }])
  })

  test('test_circuitEnds_ignores_cables_without_a_circuit_and_a_named_device_end', () => {
    const ends = circuitEnds([
      { site: 'ams1', cables: [{ a: dev('r-ams'), b: dev('sw-ams') }, { a: cir('C1'), b: { kind: 'device', name: 'p1', deviceName: null } }, { a: null, b: cir('C2') }] },
    ])
    expect(ends).toEqual([])
  })
})

describe('circuitDirections', () => {
  const ends = [
    { cid: 'C1', site: 'ams1', deviceName: 'r-ams', name: 'et-0/0/5' },
    { cid: 'C1', site: 'par1', deviceName: 'r-par', name: 'et-0/0/5' },
  ]
  const port = (txBps: number | null, rxBps: number | null) => ({ 'et-0/0/5': { txBps, rxBps, capacityBps: 1e11, stale: false } })

  test('test_circuitDirections_both_ends_use_each_sites_own_tx', () => {
    const dirs = circuitDirections({ devices: { 'r-ams': port(2e9, 1e9), 'r-par': port(4e9, 3e9) } }, ends)
    expect(dirs.get('C1')).toEqual({ ams1: { bps: 2e9, pct: 2 }, par1: { bps: 4e9, pct: 4 } })
  })

  test('test_circuitDirections_null_tx_falls_back_to_far_rx', () => {
    const dirs = circuitDirections({ devices: { 'r-ams': port(null, 1e9), 'r-par': port(4e9, 3e9) } }, ends)
    expect(dirs.get('C1')).toEqual({ ams1: { bps: 3e9, pct: 3 }, par1: { bps: 4e9, pct: 4 } })
  })

  test('test_circuitDirections_one_end_monitored_uses_its_rx_for_the_far_site', () => {
    const dirs = circuitDirections({ devices: { 'r-ams': port(2e9, 1e9) } }, ends)
    expect(dirs.get('C1')).toEqual({ ams1: { bps: 2e9, pct: 2 }, par1: { bps: 1e9, pct: 1 } })
  })

  test('test_circuitDirections_pair_names_the_far_site_when_only_one_end_is_located', () => {
    const one = [ends[0]!]
    const pairOf = new Map([['C1', ['ams1', 'par1'] as const]])
    expect(circuitDirections({ devices: { 'r-ams': port(2e9, 1e9) } }, one, pairOf).get('C1')).toEqual({
      ams1: { bps: 2e9, pct: 2 },
      par1: { bps: 1e9, pct: 1 },
    })
    // without the pair, only the located site's outbound direction is known
    expect(circuitDirections({ devices: { 'r-ams': port(2e9, 1e9) } }, one).get('C1')).toEqual({ ams1: { bps: 2e9, pct: 2 } })
  })

  test('test_circuitDirections_unmonitored_circuit_is_absent', () => {
    expect(circuitDirections({ devices: {} }, ends).has('C1')).toBe(false)
  })

  test('test_circuitDirections_unknown_capacity_gives_null_pct', () => {
    const noCap = { 'et-0/0/5': { txBps: 2e9, rxBps: 1e9, capacityBps: null, stale: false } }
    expect(circuitDirections({ devices: { 'r-ams': noCap } }, ends).get('C1')).toEqual({
      ams1: { bps: 2e9, pct: null },
      par1: { bps: 1e9, pct: null },
    })
  })
})
