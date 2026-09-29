import { describe, expect, test } from 'vitest'
import { cssColor } from './cssColor'

describe('cssColor', () => {
  test('test_cssColor_bareHex_prefixesHash', () => {
    expect(cssColor('ff9800')).toBe('#ff9800')
    expect(cssColor('4caf50')).toBe('#4caf50')
    expect(cssColor('9c27b0')).toBe('#9c27b0')
    expect(cssColor('607d8b')).toBe('#607d8b')
  })

  test('test_cssColor_alreadyPrefixed_unchanged', () => {
    expect(cssColor('#dc2626')).toBe('#dc2626')
    expect(cssColor('#22c55e')).toBe('#22c55e')
  })

  test('test_cssColor_emptyOrNull_returnsNull', () => {
    expect(cssColor('')).toBe(null)
    expect(cssColor(null)).toBe(null)
    expect(cssColor(undefined)).toBe(null)
  })

  test('test_cssColor_invalidValues_returnsNull', () => {
    // Not a 6-char hex
    expect(cssColor('abc')).toBe(null)
    expect(cssColor('abcde')).toBe(null)
    expect(cssColor('abcdefg')).toBe(null)
    // Invalid hex chars
    expect(cssColor('gggggg')).toBe(null)
    expect(cssColor('zzzzzz')).toBe(null)
  })

  test('test_cssColor_uppercase_normalizesToLowercase', () => {
    expect(cssColor('FF9800')).toBe('#ff9800')
    expect(cssColor('#AABBCC')).toBe('#aabbcc')
  })
})
