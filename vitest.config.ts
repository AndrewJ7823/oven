import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/transports/**'],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 },
    },
  },
})
