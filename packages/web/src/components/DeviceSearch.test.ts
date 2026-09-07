import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, test } from 'vitest'
import { DeviceSearch } from './DeviceSearch'
import type { DeviceIndexEntry } from '../lib/deviceSearch'

const DEVICE: DeviceIndexEntry = {
  id: '1',
  name: 'leaf-1',
  siteName: 'ams1',
  rackId: 'rack-1',
  rackName: 'rack-1',
  position: 1,
  roleName: 'leaf',
  roleColor: '334155',
  model: '7050',
  status: 'active',
}

function render(overrides: Partial<Parameters<typeof DeviceSearch>[0]> = {}) {
  return renderToStaticMarkup(createElement(DeviceSearch, {
    devices: [DEVICE],
    indexedSites: 2,
    totalSites: 2,
    prewarmEnabled: true,
    isLoading: false,
    isError: false,
    onSelect: () => {},
    ...overrides,
  }))
}

describe('DeviceSearch', () => {
  test('test_device_search_loading_keeps_search_visible', () => {
    expect(render({ devices: [], isLoading: true })).toContain('loading device index…')
  })

  test('test_device_search_partial_coverage_labels_indexed_sites', () => {
    const html = render({ indexedSites: 1, totalSites: 3 })
    expect(html).toContain('1 of 3 sites indexed')
    expect(html).toContain('1 indexed')
  })

  test('test_device_search_partial_coverage_without_prewarm_labels_stalled_progress', () => {
    expect(render({ indexedSites: 1, totalSites: 3, prewarmEnabled: false })).toContain(
      'prewarm disabled',
    )
  })

  test('test_device_search_empty_index_keeps_search_visible', () => {
    expect(render({ devices: [], indexedSites: 2, totalSites: 2 })).toContain('0 indexed')
  })

  test('test_device_search_failed_refresh_retains_cached_results', () => {
    const html = render({ isError: true })
    expect(html).toContain('refresh failed; showing cached results')
    expect(html).toContain('1 indexed')
  })
})
