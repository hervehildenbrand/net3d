import { describe, expect, it } from 'vitest'
import { cartoTileUrl } from './tileUrl'

describe('cartoTileUrl', () => {
  it('appends ?key= when a key is provided', () => {
    expect(cartoTileUrl('abc123')).toBe(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=abc123',
    )
  })

  it('omits the key parameter when no key is set', () => {
    expect(cartoTileUrl(undefined)).toBe(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    )
    expect(cartoTileUrl('')).toBe(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    )
  })
})
