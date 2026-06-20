import { describe, expect, test } from 'vitest'
import { collectSubnets, deviceSubnet, rackDominantSubnet, subnetColor } from './subnetColoring'
import type { SiteDevice, SiteRack } from '../hooks/useSiteDetail'

function mkDevice(primaryIp: string | null, position: number | null = 1): SiteDevice {
  return {
    id: `d-${primaryIp}-${position}`,
    name: 'dev',
    position,
    face: 'front',
    roleName: 'server',
    roleColor: 'aabbcc',
    uHeight: 1,
    model: 'm',
    manufacturer: 'mfr',
    isFullDepth: true,
    status: 'active',
    serial: null,
    assetTag: null,
    description: null,
    platform: null,
    primaryIp,
    oobIp: null,
  }
}

function mkRack(devices: SiteDevice[]): SiteRack {
  return { id: 'r', name: 'rack', uHeight: 42, location: null, devices }
}

describe('deviceSubnet', () => {
  test('masks an address to its /24 network', () => {
    expect(deviceSubnet(mkDevice('10.5.20.7/24'))).toBe('10.5.20.0/24')
  })

  test('honors the prefix length when computing the network', () => {
    expect(deviceSubnet(mkDevice('10.5.20.7/16'))).toBe('10.5.0.0/16')
    expect(deviceSubnet(mkDevice('192.168.1.130/25'))).toBe('192.168.1.128/25')
  })

  test('a bare address (no mask) is treated as a /32 host route', () => {
    expect(deviceSubnet(mkDevice('10.5.20.7'))).toBe('10.5.20.7/32')
  })

  test('no primary IP yields no subnet', () => {
    expect(deviceSubnet(mkDevice(null))).toBe(null)
  })
})

describe('collectSubnets', () => {
  test('returns the distinct subnets present, sorted, from placeable devices', () => {
    const rack = mkRack([
      mkDevice('10.5.21.5/24'),
      mkDevice('10.5.20.9/24'),
      mkDevice('10.5.20.4/24'),
      mkDevice(null),
      mkDevice('10.5.30.1/24', null), // unplaceable -> ignored
    ])
    expect(collectSubnets([rack])).toEqual(['10.5.20.0/24', '10.5.21.0/24'])
  })
})

describe('rackDominantSubnet', () => {
  test('returns the most common subnet among the placeable devices', () => {
    const rack = mkRack([
      mkDevice('10.5.20.1/24'),
      mkDevice('10.5.20.2/24'),
      mkDevice('10.5.21.9/24'),
    ])
    expect(rackDominantSubnet(rack)).toBe('10.5.20.0/24')
  })

  test('is null when no device has an IP', () => {
    expect(rackDominantSubnet(mkRack([mkDevice(null)]))).toBe(null)
  })
})

describe('subnetColor', () => {
  test('assigns a stable, distinct color per subnet by position', () => {
    const subnets = ['10.5.20.0/24', '10.5.21.0/24']
    const a = subnetColor('10.5.20.0/24', subnets)
    const b = subnetColor('10.5.21.0/24', subnets)
    expect(a).toMatch(/^#[0-9a-f]{6}$/i)
    expect(a).not.toBe(b)
    expect(subnetColor('10.5.20.0/24', subnets)).toBe(a) // stable
  })

  test('a subnet not in the list falls back to a neutral color', () => {
    expect(subnetColor('10.9.9.0/24', ['10.5.20.0/24'])).toBe(subnetColor('10.8.8.0/24', ['10.5.20.0/24']))
  })
})
