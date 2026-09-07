import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      reporter: ['text-summary', 'json', 'json-summary', 'html'],
      thresholds: {
        'packages/server/src/cache.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        'packages/web/src/lib/lldpSemaphore.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // Unit-test gate for application logic; the report also includes TSX UI.
        'packages/*/src/**/*.ts': {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 80,
        },
      },
    },
  },
})
