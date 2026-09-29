import { describe, expect, test } from 'vitest'
import { chunkForSwitchHover } from './chunkForSwitchHover'

describe('chunkForSwitchHover', () => {
  test('test_chunkForSwitchHover_physicalMode_returnsDiagram', () => {
    // When in physical mode, hovering the switch means switching TO logical -> preload diagram
    expect(chunkForSwitchHover('physical')).toBe('diagram')
  })

  test('test_chunkForSwitchHover_logicalMode_returnsScene', () => {
    // When in logical mode, hovering the switch means switching TO physical -> preload scene
    expect(chunkForSwitchHover('logical')).toBe('scene')
  })
})
