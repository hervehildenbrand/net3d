import { describe, expect, test } from 'vitest'
import { faceLabel, faceMatchesView } from '../src/face'

describe('faceLabel', () => {
  test('null face on a non-full-depth device reads as front (NetBox default)', () => {
    expect(faceLabel(null, false)).toBe('front')
  })

  test('full-depth wins regardless of face value', () => {
    expect(faceLabel('FRONT', true)).toBe('full-depth')
    expect(faceLabel('REAR', true)).toBe('full-depth')
    expect(faceLabel(null, true)).toBe('full-depth')
  })

  test('normalizes uppercase NetBox values to lowercase', () => {
    expect(faceLabel('FRONT', false)).toBe('front')
    expect(faceLabel('REAR', false)).toBe('rear')
  })

  test('passes lowercase values through', () => {
    expect(faceLabel('front', false)).toBe('front')
    expect(faceLabel('rear', false)).toBe('rear')
  })

  test('empty string is treated as null (front)', () => {
    expect(faceLabel('', false)).toBe('front')
  })

  test('unexpected values fall back to front', () => {
    expect(faceLabel('left', false)).toBe('front')
  })
})

describe('faceMatchesView', () => {
  test('full-depth devices match both views', () => {
    expect(faceMatchesView({ face: null, isFullDepth: true }, 'front')).toBe(true)
    expect(faceMatchesView({ face: null, isFullDepth: true }, 'rear')).toBe(true)
  })

  test('front device matches the front view only', () => {
    expect(faceMatchesView({ face: 'FRONT', isFullDepth: false }, 'front')).toBe(true)
    expect(faceMatchesView({ face: 'FRONT', isFullDepth: false }, 'rear')).toBe(false)
  })

  test('rear device matches the rear view only', () => {
    expect(faceMatchesView({ face: 'REAR', isFullDepth: false }, 'rear')).toBe(true)
    expect(faceMatchesView({ face: 'REAR', isFullDepth: false }, 'front')).toBe(false)
  })

  test('null face behaves as front-mounted', () => {
    expect(faceMatchesView({ face: null, isFullDepth: false }, 'front')).toBe(true)
    expect(faceMatchesView({ face: null, isFullDepth: false }, 'rear')).toBe(false)
  })
})
