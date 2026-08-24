import { describe, expect, test } from 'vitest'
import { extractFrontRearPairs, buildCablePath, buildCablePathThrough, groupTraceHops, TraceCable, TracePath } from './cabletrace'

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

describe('groupTraceHops', () => {
  test('collapses panel front/rear hop pairs into one row per device', () => {
    const path = {
      hops: [
        { kind: 'interface' as const, portName: 'Ethernet1', deviceName: 'leaf-1', rackName: 'SRV-01' },
        { kind: 'front-port' as const, portName: 'Front1', deviceName: 'pp-1', rackName: 'SRV-01' },
        { kind: 'rear-port' as const, portName: 'Rear1', deviceName: 'pp-1', rackName: 'SRV-01' },
        { kind: 'rear-port' as const, portName: 'Rear1', deviceName: 'xc-1', rackName: 'NET-01' },
        { kind: 'front-port' as const, portName: 'Front1', deviceName: 'xc-1', rackName: 'NET-01' },
        { kind: 'interface' as const, portName: 'leaf1-1', deviceName: 'spine-01', rackName: 'NET-01' },
      ],
      cableIds: ['c1', 'c2', 'c3'],
      complete: true,
      panelCount: 2,
    }
    expect(groupTraceHops(path)).toEqual([
      { deviceName: 'leaf-1', rackName: 'SRV-01', ports: ['Ethernet1'], panel: false },
      { deviceName: 'pp-1', rackName: 'SRV-01', ports: ['Front1', 'Rear1'], panel: true },
      { deviceName: 'xc-1', rackName: 'NET-01', ports: ['Rear1', 'Front1'], panel: true },
      { deviceName: 'spine-01', rackName: 'NET-01', ports: ['leaf1-1'], panel: false },
    ])
  })

  test('a lone unpaired panel hop still becomes its own row', () => {
    const path = {
      hops: [
        { kind: 'interface' as const, portName: 'eth0', deviceName: 'sw1', rackName: 'R1' },
        { kind: 'front-port' as const, portName: 'f1', deviceName: 'pp1', rackName: 'R1' },
      ],
      cableIds: ['c1'],
      complete: false,
      panelCount: 0,
    }
    expect(groupTraceHops(path)).toEqual([
      { deviceName: 'sw1', rackName: 'R1', ports: ['eth0'], panel: false },
      { deviceName: 'pp1', rackName: 'R1', ports: ['f1'], panel: true },
    ])
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

describe('buildCablePathThrough', () => {
  test('clicking rack panel Front1 in leaf→pp→xc→spine chain returns same path as from leaf', () => {
    // leaf:eth0 -- c1 --> pp:Front1(Rear1) -- c2 --> xc:Front1(Rear1) -- c3 --> spine:eth0
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('leaf', 'eth0'), b: front('pp', 'Front1', 'Rear1') },
      { id: 'c2', a: rear('pp', 'Rear1'), b: front('xc', 'Front1', 'Rear1') },
      { id: 'c3', a: rear('xc', 'Rear1'), b: iface('spine', 'eth0') },
    ]
    const pairs = extractFrontRearPairs(cables)
    const fromLeaf = buildCablePath(cables, pairs, 'leaf', 'eth0')
    const fromPanel = buildCablePathThrough(cables, pairs, 'pp', 'Front1')

    expect(fromLeaf).not.toBeNull()
    expect(fromPanel).toEqual(fromLeaf)
    expect(fromPanel?.hops).toHaveLength(6)
    expect(fromPanel?.panelCount).toBe(2)
    expect(fromPanel?.complete).toBe(true)
  })

  test('clicking xc Rear1 returns same path as from leaf', () => {
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('leaf', 'eth0'), b: front('pp', 'Front1', 'Rear1') },
      { id: 'c2', a: rear('pp', 'Rear1'), b: front('xc', 'Front1', 'Rear1') },
      { id: 'c3', a: rear('xc', 'Rear1'), b: iface('spine', 'eth0') },
    ]
    const pairs = extractFrontRearPairs(cables)
    const fromLeaf = buildCablePath(cables, pairs, 'leaf', 'eth0')
    const fromXcRear = buildCablePathThrough(cables, pairs, 'xc', 'Rear1')

    expect(fromXcRear).toEqual(fromLeaf)
  })

  test('chain broken beyond panel returns incomplete path anchored at reachable interface', () => {
    // leaf:eth0 -- c1 --> pp:Front1(Rear1) -- c2 --> xc:Front1(Rear1) [no c3]
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('leaf', 'eth0'), b: front('pp', 'Front1', 'Rear1') },
      { id: 'c2', a: rear('pp', 'Rear1'), b: front('xc', 'Front1', 'Rear1') },
      // no cable from xc:Rear1
    ]
    const pairs = extractFrontRearPairs(cables)
    const path = buildCablePathThrough(cables, pairs, 'pp', 'Front1')

    expect(path).not.toBeNull()
    expect(path?.complete).toBe(false)
    // Should start from leaf (the reachable interface) and walk through
    expect(path?.hops[0]).toEqual({ kind: 'interface', portName: 'eth0', deviceName: 'leaf', rackName: 'R1' })
  })

  test('fully uncabled port returns null', () => {
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('sw1', 'eth0'), b: iface('sw2', 'eth0') },
    ]
    const pairs = extractFrontRearPairs(cables)
    const path = buildCablePathThrough(cables, pairs, 'pp', 'uncabled')
    expect(path).toBeNull()
  })

  test('front port uncabled but paired rear is cabled finds the path', () => {
    // pp:Front1(Rear1) uncabled on front, but Rear1 has a cable to leaf
    const cables: TraceCable[] = [
      { id: 'c1', a: rear('pp', 'Rear1'), b: iface('leaf', 'eth0') },
      // Front1 has no direct cable, but it's paired to Rear1
    ]
    // Need a cable with front-port to populate pairs map
    const cablesWithPair: TraceCable[] = [
      // Add a dummy front-port entry to populate pairing (in real data this comes from another cable)
      { id: 'c0', a: front('pp', 'Front1', 'Rear1'), b: null }, // dangling front-port sets up the pair
      { id: 'c1', a: rear('pp', 'Rear1'), b: iface('leaf', 'eth0') },
    ]
    const pairs = extractFrontRearPairs(cablesWithPair)
    const path = buildCablePathThrough(cablesWithPair, pairs, 'pp', 'Front1')

    expect(path).not.toBeNull()
    expect(path?.hops[0]).toEqual({ kind: 'interface', portName: 'eth0', deviceName: 'leaf', rackName: 'R1' })
  })
})
