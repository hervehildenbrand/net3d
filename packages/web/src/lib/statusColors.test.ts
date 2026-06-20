import { describe, expect, test } from 'vitest'
import { statusColor, collectStatuses } from './statusColors'
import type { SiteDevice, SiteRack } from '../hooks/useSiteDetail'

function mkDevice(status: string, position: number | null = 1): SiteDevice {
  return {
    id: `d-${status}-${position}`,
    name: 'dev',
    position,
    face: 'front',
    roleName: 'server',
    roleColor: 'aabbcc',
    uHeight: 1,
    model: 'm',
    manufacturer: 'mfr',
    isFullDepth: true,
    status,
  }
}

function mkRack(devices: SiteDevice[]): SiteRack {
  return { id: 'r', name: 'rack', uHeight: 42, location: null, devices }
}

describe('statusColor', () => {
  test('known statuses get distinct, stable colors', () => {
    const active = statusColor('active')
    const offline = statusColor('offline')
    expect(active).toMatch(/^#[0-9a-f]{6}$/i)
    expect(offline).toMatch(/^#[0-9a-f]{6}$/i)
    expect(active).not.toBe(offline)
  })

  test('is case-insensitive', () => {
    expect(statusColor('Active')).toBe(statusColor('active'))
  })

  test('an unknown status falls back to a single neutral color', () => {
    expect(statusColor('banana')).toBe(statusColor('also-unknown'))
  })
})

describe('collectStatuses', () => {
  test('returns the distinct statuses present, known ones in lifecycle order', () => {
    const rack = mkRack([
      mkDevice('offline'),
      mkDevice('active'),
      mkDevice('planned'),
      mkDevice('active'),
    ])
    expect(collectStatuses([rack])).toEqual(['active', 'planned', 'offline'])
  })

  test('unknown statuses sort after all known ones', () => {
    const rack = mkRack([mkDevice('zzz-custom'), mkDevice('active')])
    expect(collectStatuses([rack])).toEqual(['active', 'zzz-custom'])
  })

  test('ignores devices with no rack position (unplaceable)', () => {
    const rack = mkRack([mkDevice('active', 1), mkDevice('staged', null)])
    expect(collectStatuses([rack])).toEqual(['active'])
  })
})
