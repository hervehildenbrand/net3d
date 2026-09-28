import { describe, expect, test } from 'vitest'
import { baseInterface, safeName, classifyTier } from '../src/logical'

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
