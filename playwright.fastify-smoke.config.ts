import { defineConfig, devices } from '@playwright/test'

const isCi = Boolean(process.env.CI)

export default defineConfig({
  testDir: './server/fastify/browser-smoke',
  forbidOnly: isCi,
  fullyParallel: false,
  // Stateful tests within a spec stay serial; independent files use isolated
  // random-port Fastify/data harnesses and can share a local machine safely.
  workers: isCi ? 1 : 2,
  timeout: 30_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
  },
})
