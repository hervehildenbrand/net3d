import { describe, expect, test } from 'vitest'
import { extractFrontRearPairs, buildCablePath, TraceCable, TracePath } from './cabletrace'

// Helper to build cable ends with minimal boilerplate
const iface = (dev: string, name: string, rack = 'R1'): NonNullable<TraceCable['a']> => ({
  kind: 'device', name, deviceName: dev, rackName: rack, termType: 'interface',
})
const front = (dev: string, name: string, rear: string, rack = 'R1'): NonNullable<TraceCable['a']> => ({
  kind: 'device', name, deviceName: dev, rackName: rack, termType: 'front-port', pairedPort: rear,
})
const rear = (dev: string, name: string, rack = 'R1'): NonNullable<TraceCable['a']> => ({
  kind: 'device', name, deviceName: dev, rackName: rack, termType: 'rear-port',
})

describe('extractFrontRearPairs', () => {
  test('extracts both directions from front-port with pairedPort', () => {
    const cables: TraceCable[] = [
      { id: '1', a: front('pp1', 'port1', 'rear1'), b: iface('sw1', 'eth0') },
    ]
    const pairs = extractFrontRearPairs(cables)
    expect(pairs.get('pp1\0port1')).toBe('pp1\0rear1')
    expect(pairs.get('pp1\0rear1')).toBe('pp1\0port1')
  })

  test('ignores ends without deviceName', () => {
    const cables: TraceCable[] = [
      { id: '1', a: { kind: 'device', name: 'port1', deviceName: null, rackName: null, termType: 'front-port', pairedPort: 'rear1' }, b: null },
    ]
    const pairs = extractFrontRearPairs(cables)
    expect(pairs.size).toBe(0)
  })

  test('ignores non-front-port ends', () => {
    const cables: TraceCable[] = [
      { id: '1', a: rear('pp1', 'rear1'), b: iface('sw1', 'eth0') },
    ]
    const pairs = extractFrontRearPairs(cables)
    expect(pairs.size).toBe(0)
  })

  test('handles deviceName containing pipe character', () => {
    const cables: TraceCable[] = [
      { id: '1', a: front('pp|panel', 'port1', 'rear1'), b: iface('sw1', 'eth0') },
    ]
    const pairs = extractFrontRearPairs(cables)
    // Keys use \0 delimiter internally, but test via the actual lookup
    expect(pairs.get('pp|panel\0port1')).toBe('pp|panel\0rear1')
    expect(pairs.get('pp|panel\0rear1')).toBe('pp|panel\0port1')
  })
})

describe('buildCablePath', () => {
  test('direct interface<->interface (2 hops, 1 cable, complete, panelCount 0)', () => {
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('sw1', 'eth0'), b: iface('sw2', 'eth0') },
    ]
    const pairs = extractFrontRearPairs(cables)
    const path = buildCablePath(cables, pairs, 'sw1', 'eth0')
    expect(path).toEqual<TracePath>({
      hops: [
        { kind: 'interface', portName: 'eth0', deviceName: 'sw1', rackName: 'R1' },
        { kind: 'interface', portName: 'eth0', deviceName: 'sw2', rackName: 'R1' },
      ],
      cableIds: ['c1'],
      complete: true,
      panelCount: 0,
    })
  })

  test('one panel (4 hops, 2 cables, complete, panelCount 1)', () => {
    // sw1:eth0 -- cable1 --> pp1:front1 (rear1) -- cable2 --> sw2:eth0
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('sw1', 'eth0'), b: front('pp1', 'front1', 'rear1') },
      { id: 'c2', a: rear('pp1', 'rear1'), b: iface('sw2', 'eth0') },
    ]
    const pairs = extractFrontRearPairs(cables)
    const path = buildCablePath(cables, pairs, 'sw1', 'eth0')
    expect(path).toEqual<TracePath>({
      hops: [
        { kind: 'interface', portName: 'eth0', deviceName: 'sw1', rackName: 'R1' },
        { kind: 'front-port', portName: 'front1', deviceName: 'pp1', rackName: 'R1' },
        { kind: 'rear-port', portName: 'rear1', deviceName: 'pp1', rackName: 'R1' },
        { kind: 'interface', portName: 'eth0', deviceName: 'sw2', rackName: 'R1' },
      ],
      cableIds: ['c1', 'c2'],
      complete: true,
      panelCount: 1,
    })
  })

  test('two cascaded panels (6 hops, 3 cables, panelCount 2)', () => {
    // sw1:eth0 -- c1 --> pp1:f1(r1) -- c2 --> pp2:f1(r1) -- c3 --> sw2:eth0
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('sw1', 'eth0'), b: front('pp1', 'f1', 'r1') },
      { id: 'c2', a: rear('pp1', 'r1'), b: front('pp2', 'f1', 'r1') },
      { id: 'c3', a: rear('pp2', 'r1'), b: iface('sw2', 'eth0') },
    ]
    const pairs = extractFrontRearPairs(cables)
    const path = buildCablePath(cables, pairs, 'sw1', 'eth0')
    expect(path).toEqual<TracePath>({
      hops: [
        { kind: 'interface', portName: 'eth0', deviceName: 'sw1', rackName: 'R1' },
        { kind: 'front-port', portName: 'f1', deviceName: 'pp1', rackName: 'R1' },
        { kind: 'rear-port', portName: 'r1', deviceName: 'pp1', rackName: 'R1' },
        { kind: 'front-port', portName: 'f1', deviceName: 'pp2', rackName: 'R1' },
        { kind: 'rear-port', portName: 'r1', deviceName: 'pp2', rackName: 'R1' },
        { kind: 'interface', portName: 'eth0', deviceName: 'sw2', rackName: 'R1' },
      ],
      cableIds: ['c1', 'c2', 'c3'],
      complete: true,
      panelCount: 2,
    })
  })

  test('front port whose rear has no onward cable (complete false)', () => {
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('sw1', 'eth0'), b: front('pp1', 'f1', 'r1') },
      // no cable connected to pp1:r1
    ]
    const pairs = extractFrontRearPairs(cables)
    const path = buildCablePath(cables, pairs, 'sw1', 'eth0')
    expect(path?.complete).toBe(false)
    expect(path?.hops).toEqual([
      { kind: 'interface', portName: 'eth0', deviceName: 'sw1', rackName: 'R1' },
      { kind: 'front-port', portName: 'f1', deviceName: 'pp1', rackName: 'R1' },
      { kind: 'rear-port', portName: 'r1', deviceName: 'pp1', rackName: 'R1' },
    ])
    expect(path?.panelCount).toBe(1)
  })

  test('pair missing in map (complete false)', () => {
    // front-port end without pairedPort set
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('sw1', 'eth0'), b: { kind: 'device', name: 'f1', deviceName: 'pp1', rackName: 'R1', termType: 'front-port' } },
    ]
    const pairs = extractFrontRearPairs(cables)
    const path = buildCablePath(cables, pairs, 'sw1', 'eth0')
    expect(path?.complete).toBe(false)
    expect(path?.hops).toHaveLength(2) // sw1:eth0, pp1:f1
  })

  test('start interface with no cable (null)', () => {
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('sw2', 'eth0'), b: iface('sw3', 'eth0') },
    ]
    const pairs = extractFrontRearPairs(cables)
    const path = buildCablePath(cables, pairs, 'sw1', 'eth0')
    expect(path).toBeNull()
  })

  test('cycle between two panels (terminates, complete false)', () => {
    // Malformed: pp1:r1 -> pp2:f1(r1) -> pp1:f1(r1) creates a loop
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('sw1', 'eth0'), b: front('pp1', 'f1', 'r1') },
      { id: 'c2', a: rear('pp1', 'r1'), b: front('pp2', 'f1', 'r1') },
      { id: 'c3', a: rear('pp2', 'r1'), b: front('pp1', 'f1', 'r1') }, // loops back to pp1:f1
    ]
    const pairs = extractFrontRearPairs(cables)
    const path = buildCablePath(cables, pairs, 'sw1', 'eth0')
    expect(path?.complete).toBe(false)
    // Traverses all cables, then cycle detected when c3 leads back to pp1:f1
    expect(path?.cableIds).toEqual(['c1', 'c2', 'c3'])
    expect(path?.hops).toEqual([
      { kind: 'interface', portName: 'eth0', deviceName: 'sw1', rackName: 'R1' },
      { kind: 'front-port', portName: 'f1', deviceName: 'pp1', rackName: 'R1' },
      { kind: 'rear-port', portName: 'r1', deviceName: 'pp1', rackName: 'R1' },
      { kind: 'front-port', portName: 'f1', deviceName: 'pp2', rackName: 'R1' },
      { kind: 'rear-port', portName: 'r1', deviceName: 'pp2', rackName: 'R1' },
    ])
  })

  test('trace from far side - leaf interface to rear port', () => {
    // Trace starting from sw2:eth0 which connects to pp1:r1 (the rear side)
    // pp1:f1(r1) was cabled from sw1 - pairs map built from front side must carry through
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('sw1', 'eth0'), b: front('pp1', 'f1', 'r1') },
      { id: 'c2', a: rear('pp1', 'r1'), b: iface('sw2', 'eth0') },
    ]
    const pairs = extractFrontRearPairs(cables)
    const path = buildCablePath(cables, pairs, 'sw2', 'eth0')
    expect(path).toEqual<TracePath>({
      hops: [
        { kind: 'interface', portName: 'eth0', deviceName: 'sw2', rackName: 'R1' },
        { kind: 'rear-port', portName: 'r1', deviceName: 'pp1', rackName: 'R1' },
        { kind: 'front-port', portName: 'f1', deviceName: 'pp1', rackName: 'R1' },
        { kind: 'interface', portName: 'eth0', deviceName: 'sw1', rackName: 'R1' },
      ],
      cableIds: ['c2', 'c1'],
      complete: true,
      panelCount: 1,
    })
  })

  test('dangling cable end (b is null) terminates with complete false', () => {
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('sw1', 'eth0'), b: null },
    ]
    const pairs = extractFrontRearPairs(cables)
    const path = buildCablePath(cables, pairs, 'sw1', 'eth0')
    expect(path?.complete).toBe(false)
    expect(path?.hops).toHaveLength(1)
  })

  test('circuit/powerfeed terminates walk with complete false', () => {
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('sw1', 'eth0'), b: { kind: 'circuit', name: 'CKT-001', deviceName: null, rackName: null } },
    ]
    const pairs = extractFrontRearPairs(cables)
    const path = buildCablePath(cables, pairs, 'sw1', 'eth0')
    expect(path?.complete).toBe(false)
    expect(path?.hops).toHaveLength(2)
    expect(path?.hops[1]).toEqual({ kind: 'interface', portName: 'CKT-001', deviceName: null, rackName: null })
  })

  test('legacy payload without termType treats kind=device as interface', () => {
    const cables: TraceCable[] = [
      { id: 'c1', a: { kind: 'device', name: 'eth0', deviceName: 'sw1', rackName: 'R1' }, b: { kind: 'device', name: 'eth0', deviceName: 'sw2', rackName: 'R1' } },
    ]
    const pairs = extractFrontRearPairs(cables)
    const path = buildCablePath(cables, pairs, 'sw1', 'eth0')
    expect(path?.complete).toBe(true)
    expect(path?.hops).toEqual([
      { kind: 'interface', portName: 'eth0', deviceName: 'sw1', rackName: 'R1' },
      { kind: 'interface', portName: 'eth0', deviceName: 'sw2', rackName: 'R1' },
    ])
  })

  test('traverses panel with deviceName containing pipe character', () => {
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('sw1', 'eth0'), b: front('pp|panel', 'f1', 'r1') },
      { id: 'c2', a: rear('pp|panel', 'r1'), b: iface('sw2', 'eth0') },
    ]
    const pairs = extractFrontRearPairs(cables)
    const path = buildCablePath(cables, pairs, 'sw1', 'eth0')
    expect(path).toEqual({
      hops: [
        { kind: 'interface', portName: 'eth0', deviceName: 'sw1', rackName: 'R1' },
        { kind: 'front-port', portName: 'f1', deviceName: 'pp|panel', rackName: 'R1' },
        { kind: 'rear-port', portName: 'r1', deviceName: 'pp|panel', rackName: 'R1' },
        { kind: 'interface', portName: 'eth0', deviceName: 'sw2', rackName: 'R1' },
      ],
      cableIds: ['c1', 'c2'],
      complete: true,
      panelCount: 1,
    })
  })
})
