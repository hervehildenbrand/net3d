import { describe, expect, test } from 'vitest'
import { parseNetBoxMajor, siteRacksQuery, siteCablesQuery, circuitsQuery } from '../src/graphql-dialect'

describe('parseNetBoxMajor', () => {
  test('reads 3 from a 3.7.x version', () => {
    expect(parseNetBoxMajor('3.7.8')).toBe(3)
  })

  test('reads 4 from a 4.x version', () => {
    expect(parseNetBoxMajor('4.2.1')).toBe(4)
  })

  test('treats a 4.0 beta as 4', () => {
    expect(parseNetBoxMajor('4.0.0-beta1')).toBe(4)
  })

  test('defaults to 3 when the version is null/empty (safe for the existing instance)', () => {
    expect(parseNetBoxMajor(null)).toBe(3)
    expect(parseNetBoxMajor(undefined)).toBe(3)
    expect(parseNetBoxMajor('')).toBe(3)
  })

  test('clamps unknown future majors to 4 (strawberry dialect)', () => {
    expect(parseNetBoxMajor('5.1.0')).toBe(4)
  })
})

describe('siteRacksQuery', () => {
  test('v3 uses the graphene positional filter', () => {
    expect(siteRacksQuery('dc1', 3)).toContain('rack_list(site: "dc1")')
  })

  test('v4 uses the strawberry filters argument', () => {
    expect(siteRacksQuery('dc1', 4)).toContain('rack_list(filters: {site: {name: {exact: "dc1"}}})')
  })

  test('field selection is identical across dialects', () => {
    for (const v of [3, 4] as const) {
      const q = siteRacksQuery('dc1', v)
      expect(q).toContain('u_height')
      expect(q).toContain('is_full_depth')
      expect(q).toContain('role { name color }')
    }
  })
})

describe('siteCablesQuery', () => {
  test('v3 uses the graphene positional filter', () => {
    expect(siteCablesQuery('dc1', 3)).toContain('cable_list(site: "dc1")')
  })

  test('v4 filters cables via the termination site (CableFilter has no direct site)', () => {
    expect(siteCablesQuery('dc1', 4)).toContain(
      'cable_list(filters: {terminations: {site: {name: {exact: "dc1"}}}})',
    )
  })

  test('field selection includes both termination sides across dialects', () => {
    for (const v of [3, 4] as const) {
      const q = siteCablesQuery('dc1', v)
      expect(q).toContain('a_terminations')
      expect(q).toContain('b_terminations')
      expect(q).toContain('CircuitTerminationType')
    }
  })

  test('circuit termination fragment never selects site (dropped for 4.x compat)', () => {
    // cables.ts only needs circuit.cid; CircuitTerminationType has no site field in 4.x
    for (const v of [3, 4] as const) {
      expect(siteCablesQuery('dc1', v)).not.toContain('CircuitTerminationType { circuit { cid } site')
    }
  })
})

describe('circuitsQuery', () => {
  test('v3 reads the site directly off the termination', () => {
    expect(circuitsQuery(3)).toContain('terminations { term_side site { name } }')
  })

  test('v4 reads the site through the termination scope', () => {
    const q = circuitsQuery(4)
    expect(q).toContain('termination { __typename ... on SiteType { name } }')
  })

  test('both select cid and provider', () => {
    for (const v of [3, 4] as const) {
      expect(circuitsQuery(v)).toContain('cid')
      expect(circuitsQuery(v)).toContain('provider { name }')
    }
  })
})
