import { describe, expect, test } from 'vitest'
import { connectionErrorMessage } from './connectionError'

describe('connectionErrorMessage', () => {
  test('a 502 from the proxy points at the server logs and NetBox env', () => {
    const msg = connectionErrorMessage(new Error('sites: HTTP 502'))
    expect(msg).toMatch(/NetBox/)
    expect(msg).toMatch(/NETBOX_URL/)
  })

  test('a failed fetch points at the net3d server itself', () => {
    const msg = connectionErrorMessage(new TypeError('Failed to fetch'))
    expect(msg).toMatch(/net3d server/)
  })

  test('other HTTP errors fall through with the detail preserved', () => {
    const msg = connectionErrorMessage(new Error('sites: HTTP 500'))
    expect(msg).toMatch(/500/)
  })

  test('non-Error values still yield a string', () => {
    expect(typeof connectionErrorMessage('boom')).toBe('string')
  })
})
