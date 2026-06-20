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
      a: { kind: 'device', name: 'eth1', deviceName: 'cn12001', rackName: 'compute_6', ifaceType: '25gbase-x-sfp28' },
      b: { kind: 'device', name: 'Te0/1', deviceName: 'swm1001', rackName: 'compute_6', ifaceType: '25gbase-x-sfp28' },
    })
  })

  test('only InterfaceType carries a line rate — front/rear/console/power ports drop the type', () => {
    for (const tn of [
      'FrontPortType',
      'RearPortType',
      'ConsolePortType',
      'ConsoleServerPortType',
      'PowerPortType',
      'PowerOutletType',
    ]) {
      const [c] = normalizeRawCables([
        cable({ a_terminations: [{ ...ifaceTerm('d1', 'r1', 'p1'), __typename: tn }] }),
      ])
      expect(c!.a).toEqual({ kind: 'device', name: 'p1', deviceName: 'd1', rackName: 'r1', ifaceType: null })
    }
  })

  test('power feed terminations resolve to their rack', () => {
    const [c] = normalizeRawCables([
      cable({
        a_terminations: [{ __typename: 'PowerFeedType', name: 'feed-A', rack: { name: 'r9' } }],
      }),
    ])
    expect(c!.a).toEqual({ kind: 'powerfeed', name: 'feed-A', deviceName: null, rackName: 'r9', ifaceType: null })
  })

  test('circuit terminations resolve to the circuit cid', () => {
    const [c] = normalizeRawCables([
      cable({
        b_terminations: [
          { __typename: 'CircuitTerminationType', circuit: { cid: 'CID-7' }, site: { name: 'als' } },
        ],
      }),
    ])
    expect(c!.b).toEqual({ kind: 'circuit', name: 'CID-7', deviceName: null, rackName: null, ifaceType: null })
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
})
