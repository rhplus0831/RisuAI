import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './server/fastify/browser-smoke',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
  },
})
