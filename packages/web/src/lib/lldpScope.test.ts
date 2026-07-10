import { describe, expect, test } from 'vitest'
import type { SiteDevice, SiteRack } from '../hooks/useSiteDetail'
import { computeActiveLldpIds, isNetworkRole } from './lldpScope'

function dev(id: string, roleName: string): SiteDevice {
  return {
    id,
    name: id,
    position: 1,
    face: 'FRONT',
    roleName,
    roleColor: '00ff88',
    uHeight: 1,
    model: 'm',
    manufacturer: 'mf',
    isFullDepth: true,
    status: 'active',
  }
}

function rack(id: string, devices: SiteDevice[]): SiteRack {
  return { id, name: id.toUpperCase(), uHeight: 42, location: null, devices }
}

describe('isNetworkRole', () => {
  test('matches switch, leaf, spine, router, firewall roles case-insensitively', () => {
    expect(isNetworkRole('switch_leaf')).toBe(true)
    expect(isNetworkRole('switch_spine')).toBe(true)
    expect(isNetworkRole('Router')).toBe(true)
    expect(isNetworkRole('firewall-edge')).toBe(true)
    expect(isNetworkRole('Leaf Switch')).toBe(true)
  })

  test('rejects non-network roles, including the monitor/tor trap', () => {
    expect(isNetworkRole('server')).toBe(false)
    expect(isNetworkRole('monitor')).toBe(false)
    expect(isNetworkRole('pdu')).toBe(false)
    expect(isNetworkRole('patch panel')).toBe(false)
  })
})

describe('computeActiveLldpIds', () => {
  const racks = [
    rack('r1', [dev('lf1', 'switch_leaf'), dev('srv1', 'server')]),
    rack('r2', [dev('sp1', 'switch_spine'), dev('pdu1', 'pdu')]),
  ]

  test('returns empty set when napalm is unavailable', () => {
    expect(computeActiveLldpIds(false, 'site', racks, undefined).size).toBe(0)
  })

  test('returns empty set at map level', () => {
    expect(computeActiveLldpIds(true, 'map', racks, undefined).size).toBe(0)
  })

  test('at site level activates network-role devices across all racks only', () => {
    const ids = computeActiveLldpIds(true, 'site', racks, undefined)
    expect(ids).toEqual(new Set(['lf1', 'sp1']))
  })

  test('at rack level unions the whole selected rack with site-wide network devices', () => {
    const ids = computeActiveLldpIds(true, 'rack', racks, racks[0])
    expect(ids).toEqual(new Set(['lf1', 'srv1', 'sp1']))
  })

  test('at rack level without a resolved rack still activates site network devices', () => {
    const ids = computeActiveLldpIds(true, 'rack', racks, undefined)
    expect(ids).toEqual(new Set(['lf1', 'sp1']))
  })
})
