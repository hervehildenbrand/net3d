import { describe, expect, test } from 'vitest'
import { eventToInvalidations } from './useLiveUpdates'

describe('eventToInvalidations', () => {
  test('site scope invalidates that site plus the global lists for the active backend', () => {
    expect(
      eventToInvalidations('netbox', { type: 'invalidate', scope: 'site', site: 'AMS1' }),
    ).toEqual([
      { queryKey: ['site', 'netbox', 'AMS1'] },
      { queryKey: ['sites', 'netbox'] },
      { queryKey: ['circuits', 'netbox'] },
      { queryKey: ['devices', 'netbox'] },
    ])
  })

  test('all scope prefix-invalidates every site of the backend', () => {
    expect(eventToInvalidations('infrahub', { type: 'invalidate', scope: 'all' })).toEqual([
      { queryKey: ['site', 'infrahub'] },
      { queryKey: ['sites', 'infrahub'] },
      { queryKey: ['circuits', 'infrahub'] },
      { queryKey: ['devices', 'infrahub'] },
    ])
  })
})
