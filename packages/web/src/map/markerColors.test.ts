import { describe, expect, it } from 'vitest'
import { markerColorsForRole } from './markerColors'

describe('markerColorsForRole', () => {
  it('gives compute sites the sky palette', () => {
    expect(markerColorsForRole('compute')).toEqual({ color: '#0284c7', fill: '#38bdf8' })
  })

  it('gives pop sites a distinct warm palette', () => {
    const pop = markerColorsForRole('pop')
    expect(pop).toEqual({ color: '#c2410c', fill: '#f97316' })
    expect(pop.fill).not.toBe(markerColorsForRole('compute').fill)
  })

  it('gives untyped sites a neutral palette distinct from both roles', () => {
    const other = markerColorsForRole(null)
    expect(other.fill).not.toBe(markerColorsForRole('compute').fill)
    expect(other.fill).not.toBe(markerColorsForRole('pop').fill)
  })
})
