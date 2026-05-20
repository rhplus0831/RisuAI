import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    root: here,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 15000,
  },
})
