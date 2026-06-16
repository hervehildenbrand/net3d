import { describe, expect, test } from 'vitest'
import { API_PREFIX, apiUrl } from './api'

describe('apiUrl', () => {
  test('netbox maps to the /api prefix', () => {
    expect(apiUrl('netbox', '/sites')).toBe('/api/sites')
  })

  test('infrahub maps to the /api-infrahub prefix', () => {
    expect(apiUrl('infrahub', '/sites')).toBe('/api-infrahub/sites')
  })

  test('preserves nested paths', () => {
    expect(apiUrl('infrahub', '/devices/5/napalm/get_facts')).toBe(
      '/api-infrahub/devices/5/napalm/get_facts',
    )
  })

  test('API_PREFIX covers exactly both backends', () => {
    expect(API_PREFIX).toEqual({ netbox: '/api', infrahub: '/api-infrahub' })
  })
})
