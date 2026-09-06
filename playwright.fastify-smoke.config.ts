import { defineConfig, devices } from '@playwright/test'
import { resolveBrowserSmokeWorkers } from './util/browser-smoke-workers.js'

const isCi = Boolean(process.env.CI)

export default defineConfig({
  testDir: './server/fastify/browser-smoke',
  forbidOnly: isCi,
  fullyParallel: false,
  // Stateful tests within a spec stay serial; independent files use isolated
  // random-port Fastify/data harnesses and can share a local machine safely.
  workers: resolveBrowserSmokeWorkers({ ci: isCi, override: process.env.RISU_BROWSER_SMOKE_WORKERS }),
  globalSetup: './server/fastify/browser-smoke/globalSetup.ts',
  globalTeardown: './server/fastify/browser-smoke/globalTeardown.ts',
  timeout: 30_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
  },
})
