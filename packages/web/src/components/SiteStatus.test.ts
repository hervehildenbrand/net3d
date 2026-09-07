import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { SiteStatus } from './SiteStatus'

describe('SiteStatus', () => {
  test('test_SiteStatus_initial_load_shows_loading_state', () => {
    expect(renderToStaticMarkup(createElement(SiteStatus, { siteName: 'AMS1', loading: true, fetching: false, error: null, rackCount: undefined, onRetry: vi.fn() }))).toContain('loading racks')
  })

  test('test_SiteStatus_failed_load_shows_actionable_retry', () => {
    const html = renderToStaticMarkup(createElement(SiteStatus, { siteName: 'AMS1', loading: false, fetching: false, error: new Error('site AMS1: HTTP 502'), rackCount: undefined, onRetry: vi.fn() }))
    expect(html).toContain('Site data unavailable')
    expect(html).toContain('Retry')
  })

  test('test_SiteStatus_empty_site_shows_distinct_empty_state', () => {
    expect(renderToStaticMarkup(createElement(SiteStatus, { siteName: 'AMS1', loading: false, fetching: false, error: null, rackCount: 0, onRetry: vi.fn() }))).toContain('no racks')
  })

  test('test_SiteStatus_cached_data_background_failure_stays_visible', () => {
    const html = renderToStaticMarkup(createElement(SiteStatus, { siteName: 'AMS1', loading: false, fetching: false, error: new Error('site AMS1: HTTP 502'), rackCount: 4, onRetry: vi.fn() }))
    expect(html).toContain('4 racks')
    expect(html).toContain('showing cached data')
  })
})
