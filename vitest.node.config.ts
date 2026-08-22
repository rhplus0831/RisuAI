import { defineProject } from 'vitest/config'
import { nodeTestFiles } from './vitest.node-tests'

export default defineProject({
  resolve: {
    alias: {
      src: '/src',
    },
    conditions: ['browser'],
  },
  test: {
    name: 'frontend-node',
    allowOnly: false,
    pool: 'threads',
    environment: 'node',
    setupFiles: ['vitest.setup.ts'],
    include: [...nodeTestFiles],
  },
})
