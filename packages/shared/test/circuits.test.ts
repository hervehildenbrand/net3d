import { describe, expect, test } from 'vitest'
import { groupCircuitsBySitePair, type SiteCircuit } from '../src/circuits'

function circuit(over: Partial<SiteCircuit>): SiteCircuit {
  return {
    id: '1',
    cid: 'CID-1',
    provider: 'Lumen',
    siteA: 'AMS1',
    siteZ: 'FRA1',
    commitRate: null,
    status: 'active',
    description: null,
    ...over,
  }
}

describe('groupCircuitsBySitePair', () => {
  test('groups by undirected site pair and counts members', () => {
    const groups = groupCircuitsBySitePair([
      circuit({ id: '1', siteA: 'FRA1', siteZ: 'AMS1' }),
      circuit({ id: '2', siteA: 'AMS1', siteZ: 'FRA1' }),
      circuit({ id: '3', siteA: 'AMS1', siteZ: 'LHR1' }),
    ])
    expect(groups).toHaveLength(2)
    const amsFra = groups.find((g) => g.siteZ === 'FRA1')!
    expect(amsFra.siteA).toBe('AMS1')
    expect(amsFra.count).toBe(2)
    expect(amsFra.circuitIds).toEqual(['1', '2'])
  })

  test('drops same-site circuits', () => {
    expect(groupCircuitsBySitePair([circuit({ siteA: 'AMS1', siteZ: 'AMS1' })])).toHaveLength(0)
  })

  test('carries the member circuits for tooltips', () => {
    const a = circuit({ id: '1', cid: 'LUMEN-001', commitRate: 100_000_000 })
    const b = circuit({ id: '2', cid: 'COLT-002', commitRate: 400_000_000 })
    const [group] = groupCircuitsBySitePair([a, b])
    expect(group!.circuits.map((c) => c.cid)).toEqual(['LUMEN-001', 'COLT-002'])
  })

  test('exposes the max commit rate of the pair for line sizing', () => {
    const [group] = groupCircuitsBySitePair([
      circuit({ id: '1', commitRate: 10_000_000 }),
      circuit({ id: '2', commitRate: 400_000_000 }),
      circuit({ id: '3', commitRate: null }),
    ])
    expect(group!.maxCommitRate).toBe(400_000_000)
  })

  test('maxCommitRate is null when no member documents a rate', () => {
    const [group] = groupCircuitsBySitePair([circuit({ commitRate: null })])
    expect(group!.maxCommitRate).toBeNull()
  })
})
