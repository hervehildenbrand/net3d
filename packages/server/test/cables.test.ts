import { describe, expect, test } from 'vitest'
import { normalizeRawCables, type RawCable } from '../src/cables'

const ifaceTerm = (device: string, rack: string | null, name = 'eth0', type = '25gbase-x-sfp28') => ({
  __typename: 'InterfaceType',
  name,
  type,
  device: { name: device, rack: rack ? { name: rack } : null },
})

const cable = (over: Partial<RawCable> = {}): RawCable => ({
  id: '1',
  type: 'cat6',
  status: 'CONNECTED',
  color: '',
  a_terminations: [ifaceTerm('cn12001', 'compute_6', 'eth1')],
  b_terminations: [ifaceTerm('swm1001', 'compute_6', 'Te0/1')],
  ...over,
})

describe('normalizeRawCables', () => {
  test('maps interface terminations to device/rack endpoints, capturing the interface type', () => {
    const [c] = normalizeRawCables([cable()])
    expect(c).toEqual({
      id: '1',
      type: 'cat6',
      status: 'CONNECTED',
      color: '',
      a: { kind: 'device', name: 'eth1', deviceName: 'cn12001', rackName: 'compute_6', ifaceType: '25gbase-x-sfp28', termType: 'interface', pairedPort: null },
      b: { kind: 'device', name: 'Te0/1', deviceName: 'swm1001', rackName: 'compute_6', ifaceType: '25gbase-x-sfp28', termType: 'interface', pairedPort: null },
    })
  })

  test('only InterfaceType carries a line rate — front/rear/console/power ports drop the type', () => {
    const typeMap: Record<string, 'interface' | 'front-port' | 'rear-port' | 'other'> = {
      FrontPortType: 'front-port',
      RearPortType: 'rear-port',
      ConsolePortType: 'other',
      ConsoleServerPortType: 'other',
      PowerPortType: 'other',
      PowerOutletType: 'other',
    }
    for (const tn of Object.keys(typeMap)) {
      const [c] = normalizeRawCables([
        cable({ a_terminations: [{ ...ifaceTerm('d1', 'r1', 'p1'), __typename: tn }] }),
      ])
      expect(c!.a).toEqual({ kind: 'device', name: 'p1', deviceName: 'd1', rackName: 'r1', ifaceType: null, termType: typeMap[tn], pairedPort: null })
    }
  })

  test('power feed terminations resolve to their rack', () => {
    const [c] = normalizeRawCables([
      cable({
        a_terminations: [{ __typename: 'PowerFeedType', name: 'feed-A', rack: { name: 'r9' } }],
      }),
    ])
    expect(c!.a).toEqual({ kind: 'powerfeed', name: 'feed-A', deviceName: null, rackName: 'r9', ifaceType: null, termType: 'other', pairedPort: null })
  })

  test('circuit terminations resolve to the circuit cid', () => {
    const [c] = normalizeRawCables([
      cable({
        b_terminations: [
          { __typename: 'CircuitTerminationType', circuit: { cid: 'CID-7' }, site: { name: 'als' } },
        ],
      }),
    ])
    expect(c!.b).toEqual({ kind: 'circuit', name: 'CID-7', deviceName: null, rackName: null, ifaceType: null, termType: 'other', pairedPort: null })
  })

  test('normalizes NetBox 4.x lowercase status to uppercase (app compares CONNECTED)', () => {
    const [c] = normalizeRawCables([cable({ status: 'connected' })])
    expect(c!.status).toBe('CONNECTED')
  })

  test('empty termination side becomes null endpoint', () => {
    const [c] = normalizeRawCables([cable({ a_terminations: [] })])
    expect(c!.a).toBeNull()
  })

  test('unknown termination type becomes null endpoint (logged elsewhere)', () => {
    const [c] = normalizeRawCables([
      cable({ a_terminations: [{ __typename: 'MysteryType', name: 'x' }] }),
    ])
    expect(c!.a).toBeNull()
  })

  test('FrontPortType normalizes with termType front-port and pairedPort from rear_port', () => {
    const [c] = normalizeRawCables([
      cable({
        a_terminations: [{
          __typename: 'FrontPortType',
          name: 'FP1',
          device: { name: 'patch-panel-1', rack: { name: 'r1' } },
          rear_port: { name: 'RP1' },
        }],
      }),
    ])
    expect(c!.a).toEqual({
      kind: 'device',
      name: 'FP1',
      deviceName: 'patch-panel-1',
      rackName: 'r1',
      ifaceType: null,
      termType: 'front-port',
      pairedPort: 'RP1',
    })
  })

  test('FrontPortType pairedPort falls back to the 4.6 mappings list', () => {
    // NetBox 4.6 has no flat rear_port; the pairing arrives as mappings[0]
    const [c] = normalizeRawCables([
      cable({
        a_terminations: [{
          __typename: 'FrontPortType',
          name: 'FP1',
          device: { name: 'patch-panel-1', rack: { name: 'r1' } },
          mappings: [{ rear_port: { name: 'RP1' } }],
        }],
      }),
    ])
    expect(c!.a!.pairedPort).toBe('RP1')
  })

  test('RearPortType normalizes with termType rear-port and pairedPort null', () => {
    const [c] = normalizeRawCables([
      cable({
        a_terminations: [{
          __typename: 'RearPortType',
          name: 'RP1',
          device: { name: 'patch-panel-1', rack: { name: 'r1' } },
        }],
      }),
    ])
    expect(c!.a).toEqual({
      kind: 'device',
      name: 'RP1',
      deviceName: 'patch-panel-1',
      rackName: 'r1',
      ifaceType: null,
      termType: 'rear-port',
      pairedPort: null,
    })
  })

  test('InterfaceType normalizes with termType interface and pairedPort null', () => {
    const [c] = normalizeRawCables([cable()])
    expect(c!.a!.termType).toBe('interface')
    expect(c!.a!.pairedPort).toBeNull()
  })
})
