import { describe, expect, test } from 'vitest'
import type { SiteDevice, SitePowerFeed, SiteRack } from '../hooks/useSiteDetail'
import { tracePowerChain } from './powerChain'

function dev(overrides: Partial<SiteDevice> = {}): SiteDevice {
  return {
    id: 'd1',
    name: 'dev',
    position: 1,
    face: 'FRONT',
    roleName: 'server',
    roleColor: '00ff88',
    uHeight: 1,
    model: 'm',
    manufacturer: 'mf',
    isFullDepth: true,
    status: 'active',
    ...overrides,
  }
}

function rack(id: string, name: string, devices: SiteDevice[]): SiteRack {
  return { id, name, uHeight: 42, location: null, devices }
}

function feed(overrides: Partial<SitePowerFeed> = {}): SitePowerFeed {
  return {
    id: 'f1',
    name: 'FEED-A',
    status: 'active',
    voltage: 230,
    amperage: 32,
    phase: 'single-phase',
    supply: 'ac',
    type: 'primary',
    maxUtilization: 80,
    panelName: 'PANEL-A',
    rackName: 'R1',
    ...overrides,
  }
}

const power = (feeds: SitePowerFeed[]) => ({ panels: [], feeds })

describe('tracePowerChain', () => {
  test('panel source pulls every feed on that panel, their racks, and devices', () => {
    const racks = [
      rack('r1', 'R1', [dev({ id: 'a', name: 'srv-a' }), dev({ id: 'b', name: 'srv-b' })]),
      rack('r2', 'R2', [dev({ id: 'c', name: 'srv-c' })]),
      rack('r3', 'R3', [dev({ id: 'd', name: 'srv-d' })]),
    ]
    const feeds = [
      feed({ id: 'f1', name: 'PANEL-A:FEED1', panelName: 'PANEL-A', rackName: 'R1' }),
      feed({ id: 'f2', name: 'PANEL-A:FEED2', panelName: 'PANEL-A', rackName: 'R2' }),
      feed({ id: 'f3', name: 'PANEL-B:FEED1', panelName: 'PANEL-B', rackName: 'R3' }),
    ]
    const chain = tracePowerChain(racks, power(feeds), { kind: 'panel', name: 'PANEL-A' })
    expect([...chain.feedNames].sort()).toEqual(['PANEL-A:FEED1', 'PANEL-A:FEED2'])
    expect([...chain.rackIds].sort()).toEqual(['r1', 'r2'])
    expect([...chain.deviceNames].sort()).toEqual(['srv-a', 'srv-b', 'srv-c'])
  })

  test('feed source traces just that feed and its rack', () => {
    const racks = [rack('r1', 'R1', [dev({ name: 'srv-a' })]), rack('r2', 'R2', [dev({ name: 'srv-c' })])]
    const feeds = [feed({ id: 'f1', name: 'FEED1', rackName: 'R1' }), feed({ id: 'f2', name: 'FEED2', rackName: 'R2' })]
    const chain = tracePowerChain(racks, power(feeds), { kind: 'feed', name: 'FEED1' })
    expect([...chain.feedNames]).toEqual(['FEED1'])
    expect([...chain.rackIds]).toEqual(['r1'])
    expect([...chain.deviceNames]).toEqual(['srv-a'])
  })

  test('an A-side panel does not pull B-side feeds (redundancy isolation)', () => {
    const racks = [rack('r1', 'R1', [dev({ name: 'srv-a' })])]
    const feeds = [
      feed({ id: 'f1', name: 'PDU-1-A', panelName: 'PANEL-A', rackName: 'R1' }),
      feed({ id: 'f2', name: 'PDU-1-B', panelName: 'PANEL-B', rackName: 'R1' }),
    ]
    const chain = tracePowerChain(racks, power(feeds), { kind: 'panel', name: 'PANEL-A' })
    expect([...chain.feedNames]).toEqual(['PDU-1-A'])
    expect([...chain.sides]).toEqual(['A'])
  })

  test('a panel with no feeds yields empty sets, not a throw', () => {
    const racks = [rack('r1', 'R1', [dev()])]
    const chain = tracePowerChain(racks, power([]), { kind: 'panel', name: 'GHOST' })
    expect(chain.feedNames.size).toBe(0)
    expect(chain.rackIds.size).toBe(0)
    expect(chain.deviceNames.size).toBe(0)
    expect(chain.sides.size).toBe(0)
  })

  test('skips devices without a U-position (not really racked)', () => {
    const racks = [rack('r1', 'R1', [dev({ name: 'srv-a' }), dev({ name: 'ghost', position: null })])]
    const chain = tracePowerChain(racks, power([feed({ rackName: 'R1' })]), { kind: 'feed', name: 'FEED-A' })
    expect([...chain.deviceNames]).toEqual(['srv-a'])
  })
})
