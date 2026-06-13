import { describe, expect, test } from 'vitest'
import { cableMedium } from '../src/cablemedium'

describe('cableMedium', () => {
  test('classifies fiber by single-mode/multi-mode prefixes', () => {
    expect(cableMedium('smf')).toBe('fiber')
    expect(cableMedium('smf-os2')).toBe('fiber')
    expect(cableMedium('mmf-om4')).toBe('fiber')
    expect(cableMedium('os1')).toBe('fiber')
    expect(cableMedium('om3')).toBe('fiber')
  })

  test('classifies copper by cat prefix', () => {
    expect(cableMedium('cat5e')).toBe('copper')
    expect(cableMedium('cat6')).toBe('copper')
    expect(cableMedium('cat6a')).toBe('copper')
  })

  test('classifies DAC / twinax', () => {
    expect(cableMedium('dac-passive')).toBe('dac')
    expect(cableMedium('dac-active')).toBe('dac')
    expect(cableMedium('aoc')).toBe('dac')
  })

  test('classifies power', () => {
    expect(cableMedium('power')).toBe('power')
  })

  test('falls back to other for unknown or null', () => {
    expect(cableMedium(null)).toBe('other')
    expect(cableMedium('')).toBe('other')
    expect(cableMedium('mystery')).toBe('other')
  })

  test('is case-insensitive', () => {
    expect(cableMedium('CAT6')).toBe('copper')
    expect(cableMedium('SMF')).toBe('fiber')
  })
})
