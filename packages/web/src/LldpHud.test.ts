import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { LldpHud } from './components/LldpHud'

test('test_LldpHud_all_failed_shows_incomplete_coverage_and_retry_action', () => {
  const html = renderToStaticMarkup(
    createElement(LldpHud, {
      discovery: {
        byDevice: {}, successful: 0, failed: 2, pending: 0,
        failedDeviceIds: ['leaf-1', 'leaf-2'], completed: 2, total: 2,
        discovering: false, retryFailed: vi.fn(),
      },
      undocumentedLinks: 0,
    }),
  )

  expect(html).toContain('LLDP: 0/2 devices')
  expect(html).toContain('2 failed')
  expect(html).toContain('Retry failed')
  expect(html).not.toContain('0 undocumented links')
})

test('test_LldpHud_mixed_coverage_shows_links_and_failure_count', () => {
  const html = renderToStaticMarkup(
    createElement(LldpHud, {
      discovery: {
        byDevice: {}, successful: 2, failed: 1, pending: 0,
        failedDeviceIds: ['leaf-3'], completed: 3, total: 3,
        discovering: false, retryFailed: vi.fn(),
      },
      undocumentedLinks: 4,
    }),
  )

  expect(html).toContain('LLDP: 2/3 devices')
  expect(html).toContain('4 undocumented links')
  expect(html).toContain('1 failed')
})

test('test_LldpHud_pending_coverage_shows_progress_counts', () => {
  const html = renderToStaticMarkup(
    createElement(LldpHud, {
      discovery: {
        byDevice: {}, successful: 1, failed: 0, pending: 2,
        failedDeviceIds: [], completed: 1, total: 3,
        discovering: true, retryFailed: vi.fn(),
      },
      undocumentedLinks: 0,
    }),
  )

  expect(html).toContain('discovering cabling 1/3 devices')
  expect(html).toContain('2 pending')
})
