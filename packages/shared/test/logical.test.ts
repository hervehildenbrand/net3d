import { describe, expect, test } from 'vitest'
import { baseInterface, safeName, classifyTier, sotLinks, factCable } from '../src/logical'
import type { TraceCable } from '../src/cabletrace'

describe('baseInterface', () => {
  test('test_baseInterface_junosUnit_stripsSuffix', () => {
    expect(baseInterface('et-0/0/0.0')).toBe('et-0/0/0')
    expect(baseInterface('xe-1/2/3.100')).toBe('xe-1/2/3')
    expect(baseInterface('ge-0/0/0.999')).toBe('ge-0/0/0')
    // no unit suffix -> unchanged
    expect(baseInterface('et-0/0/0')).toBe('et-0/0/0')
    expect(baseInterface('Ethernet1/1')).toBe('Ethernet1/1')
  })
})

describe('safeName', () => {
  test('test_safeName_ipv4Anywhere_returnsNull', () => {
    // exact addresses
    expect(safeName('192.0.2.1')).toBeNull()
    expect(safeName('198.51.100.254')).toBeNull()
    expect(safeName('203.0.113.0')).toBeNull()
    // embedded in larger string
    expect(safeName('device-192.0.2.1.example.net')).toBeNull()
    expect(safeName('prefix-192.0.2.40-suffix')).toBeNull()
    // safe names pass through
    expect(safeName('edge-router-1')).toBe('edge-router-1')
    expect(safeName('site-a-leaf-01')).toBe('site-a-leaf-01')
    // null in, null out
    expect(safeName(null)).toBeNull()
  })

  test('test_safeName_ipv6OrMac_returnsNull', () => {
    // IPv6 (colon-separated hex)
    expect(safeName('2001:db8::1')).toBeNull()
    expect(safeName('fe80::1')).toBeNull()
    expect(safeName('::1')).toBeNull()
    // MAC colon notation
    expect(safeName('00:11:22:33:44:55')).toBeNull()
    expect(safeName('aa:bb:cc:dd:ee:ff')).toBeNull()
    // MAC dash notation
    expect(safeName('00-11-22-33-44-55')).toBeNull()
    expect(safeName('AA-BB-CC-DD-EE-FF')).toBeNull()
    // MAC dotted-quad-of-hex notation (Cisco-style)
    expect(safeName('0011.2233.4455')).toBeNull()
    expect(safeName('aabb.ccdd.eeff')).toBeNull()
    // safe: colons in port names are fine when not hex pattern
    expect(safeName('Ethernet1:1')).toBe('Ethernet1:1')
  })
})

describe('classifyTier', () => {
  test('test_classifyTier_showcaseAndFixtureRoles_expectedTiers', () => {
    // Showcase roles (from seed.py ROLE_COLORS)
    expect(classifyTier('spine', false)).toBe('spine')
    expect(classifyTier('Spine', false)).toBe('spine')  // case-insensitive
    expect(classifyTier('leaf', false)).toBe('leaf')
    expect(classifyTier('Leaf', false)).toBe('leaf')
    expect(classifyTier('core', false)).toBe('core')
    expect(classifyTier('Core', false)).toBe('core')
    expect(classifyTier('oob', false)).toBe('leaf')
    expect(classifyTier('server', false)).toBe('end')
    expect(classifyTier('patch-panel', false)).toBe('end')

    // Generic fixture roles
    expect(classifyTier('access', false)).toBe('leaf')
    expect(classifyTier('switch', false)).toBe('leaf')
    expect(classifyTier('router', false)).toBe('core')
    expect(classifyTier('edge', false)).toBe('core')
    expect(classifyTier('border', false)).toBe('core')
    expect(classifyTier('firewall', false)).toBe('core')
  })

  test('test_classifyTier_monitorAndStorage_end', () => {
    // 'monitor' and 'storage' must NOT match the leaf regex (which uses word-bounded 'tor')
    expect(classifyTier('monitor', false)).toBe('end')
    expect(classifyTier('storage', false)).toBe('end')
    expect(classifyTier('storage-server', false)).toBe('end')
    // 'tor' as standalone word IS leaf
    expect(classifyTier('tor', false)).toBe('leaf')
    expect(classifyTier('tor-01', false)).toBe('leaf')
    expect(classifyTier('dc1-tor', false)).toBe('leaf')
    expect(classifyTier('dc1-tor-01', false)).toBe('leaf')
  })

  test('test_classifyTier_unknownRoleWithIgp_core', () => {
    // Unknown role without IGP is end
    expect(classifyTier('database', false)).toBe('end')
    expect(classifyTier('unknown-thing', false)).toBe('end')
    // Unknown role with IGP is core
    expect(classifyTier('database', true)).toBe('core')
    expect(classifyTier('unknown-thing', true)).toBe('core')
    // Named roles still win over hasIgp
    expect(classifyTier('leaf', true)).toBe('leaf')
    expect(classifyTier('spine', true)).toBe('spine')
  })
})

// Test fixture helpers for cables
const iface = (dev: string, name: string, rack = 'R1'): NonNullable<TraceCable['a']> => ({
  kind: 'device', name, deviceName: dev, rackName: rack, termType: 'interface',
})
const front = (dev: string, name: string, rear: string, rack = 'R1'): NonNullable<TraceCable['a']> => ({
  kind: 'device', name, deviceName: dev, rackName: rack, termType: 'front-port', pairedPort: rear,
})
const rear = (dev: string, name: string, front_: string, rack = 'R1'): NonNullable<TraceCable['a']> => ({
  kind: 'device', name, deviceName: dev, rackName: rack, termType: 'rear-port', pairedPort: front_,
})
const power = (name: string, rack = 'R1'): NonNullable<TraceCable['a']> => ({
  kind: 'powerfeed', name, deviceName: null, rackName: rack,
})
const circuit = (name: string): NonNullable<TraceCable['a']> => ({
  kind: 'circuit', name, deviceName: null, rackName: null,
})

describe('sotLinks', () => {
  test('test_sotLinks_panelRouted_stableIdAcrossInputOrder', () => {
    // Panel-routed link id must not change based on input array order
    // (Task 3 relies on stable member ids)
    const cables_order1: TraceCable[] = [
      { id: 'c1', a: iface('edge-router-1', 'et-0/0/0'), b: front('panel-01', 'P1', 'R1') },
      { id: 'c2', a: rear('panel-01', 'R1', 'P1'), b: iface('spine-01', 'Ethernet1/1') },
    ]
    const cables_order2: TraceCable[] = [
      { id: 'c2', a: rear('panel-01', 'R1', 'P1'), b: iface('spine-01', 'Ethernet1/1') },
      { id: 'c1', a: iface('edge-router-1', 'et-0/0/0'), b: front('panel-01', 'P1', 'R1') },
    ]
    const links1 = sotLinks(cables_order1)
    const links2 = sotLinks(cables_order2)
    expect(links1).toHaveLength(1)
    expect(links2).toHaveLength(1)
    // Both orderings must yield identical id
    expect(links1[0]!.id).toBe(links2[0]!.id)
    // And identical endpoints (a/b)
    expect(links1[0]!.a).toEqual(links2[0]!.a)
    expect(links1[0]!.b).toEqual(links2[0]!.b)
  })

  test('test_sotLinks_directCable_oneLink', () => {
    // Direct interface<->interface cable yields one link
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('edge-router-1', 'et-0/0/0'), b: iface('spine-01', 'Ethernet1/1') },
    ]
    const links = sotLinks(cables)
    expect(links).toHaveLength(1)
    expect(links[0]).toEqual({
      id: 'c1',
      a: { deviceName: 'edge-router-1', name: 'et-0/0/0' },
      b: { deviceName: 'spine-01', name: 'Ethernet1/1' },
    })
  })

  test('test_sotLinks_panelRouted_joinsInterfaces', () => {
    // Cable through patch panel: interface -> front -> rear -> interface
    // Should collapse to one link between the two interfaces
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('edge-router-1', 'et-0/0/0'), b: front('panel-01', 'P1', 'R1') },
      { id: 'c2', a: rear('panel-01', 'R1', 'P1'), b: iface('spine-01', 'Ethernet1/1') },
    ]
    const links = sotLinks(cables)
    expect(links).toHaveLength(1)
    // id must be deterministic - use first cable's id for consistency
    expect(links[0]!.a).toEqual({ deviceName: 'edge-router-1', name: 'et-0/0/0' })
    expect(links[0]!.b).toEqual({ deviceName: 'spine-01', name: 'Ethernet1/1' })
  })

  test('test_sotLinks_incompleteTrace_omitted', () => {
    // Incomplete trace (dangling cable, no far interface) should be omitted
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('edge-router-1', 'et-0/0/0'), b: front('panel-01', 'P1', 'R1') },
      // No cable from rear port - incomplete trace
    ]
    const links = sotLinks(cables)
    expect(links).toHaveLength(0)
  })

  test('test_sotLinks_powerAndCircuitEnds_omitted', () => {
    // Power and circuit terminations should not yield links
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('edge-router-1', 'et-0/0/0'), b: power('PDU-A-1') },
      { id: 'c2', a: iface('edge-router-1', 'et-0/0/1'), b: circuit('CID-001') },
      // Direct cable for comparison - this one should still work
      { id: 'c3', a: iface('edge-router-1', 'et-0/0/2'), b: iface('spine-01', 'Ethernet1/1') },
    ]
    const links = sotLinks(cables)
    expect(links).toHaveLength(1)
    expect(links[0]!.id).toBe('c3')
  })
})

describe('factCable', () => {
  test('test_factCable_resolvedObservation_bothEnds', () => {
    // factCable builds a TopologyCable from a resolved observation
    const cable = factCable({
      device: 'edge-router-1',
      iface: 'et-0/0/0',
      remote: 'spine-01',
      remoteIface: 'Ethernet1/1',
    })
    expect(cable).toEqual({
      id: 'lldp:edge-router-1:et-0/0/0',
      a: { deviceName: 'edge-router-1', name: 'et-0/0/0' },
      b: { deviceName: 'spine-01', name: 'Ethernet1/1' },
    })
  })
})
