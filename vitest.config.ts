import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    allowOnly: false,
    projects: ['./vitest.node.config.ts', './vitest.dom.config.ts'],
  },
})
