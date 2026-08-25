import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { buildLargeCorpusFixture } from '../../../src/ts/__tests__/largeCorpusFixture.js'
import type { StartupCoordinatorSnapshot, StartupReadinessSnapshot } from '../../../src/ts/startupReadiness.js'
import {
  closeFastBootstrapHarness,
  setObserverShellMode,
  smallFastBootstrapFixture,
  startFastBootstrapHarness,
  type ObserverShellMode,
} from './fastBootstrapHarness.js'

interface ApiRequestRecord {
  method: string
  path: string
  startedAtEpochMs: number
}

interface RolloutStartupCase {
  fixture: 'small' | 'large'
  observerMode: ObserverShellMode
  observerVisibleBeforeWriter: boolean
  startup: StartupReadinessSnapshot
  coordinator: StartupCoordinatorSnapshot
  earlyRequests: {
    mutationsBeforeWriterReady: number
    generationsBeforeChatReady: number
  }
}

interface Phase7IntegrationArtifact {
  schemaVersion: 1
  startupRollout: RolloutStartupCase[]
}

const outputDir = path.resolve('fast-bootstrap-results')

test.setTimeout(240_000)

test('Phase 7 startup rollout matrix proves flag-off and flag-on boundaries on small and large fixtures', async ({
  browser,
}, testInfo) => {
  const startupRollout: RolloutStartupCase[] = []
  for (const fixture of ['small', 'large'] as const) {
    const database = fixture === 'small' ? smallFastBootstrapFixture() : buildLargeCorpusFixture().database
    for (const observerMode of ['disabled', 'enabled'] as const) {
      startupRollout.push(await runRolloutStartupCase(browser, fixture, database, observerMode))
    }
  }

  const artifact: Phase7IntegrationArtifact = { schemaVersion: 1, startupRollout }
  const machineOutput = `${JSON.stringify(artifact, null, 2)}\n`
  const humanOutput = formatIntegrationArtifact(artifact)
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(path.join(outputDir, 'phase7-integration.json'), machineOutput)
  fs.writeFileSync(path.join(outputDir, 'phase7-integration.txt'), humanOutput)
  await testInfo.attach('phase7-integration.json', { body: machineOutput, contentType: 'application/json' })
  await testInfo.attach('phase7-integration.txt', { body: humanOutput, contentType: 'text/plain' })
})

async function runRolloutStartupCase(
  browser: Browser,
  fixture: RolloutStartupCase['fixture'],
  database: Record<string, unknown>,
  observerMode: ObserverShellMode,
): Promise<RolloutStartupCase> {
  const harness = await startFastBootstrapHarness(database, {
    temporaryDirectoryPrefix: `risu-phase7-${fixture}-${observerMode}-`,
  })
  let context: BrowserContext | undefined
  try {
    context = await browser.newContext()
    await setObserverShellMode(context, observerMode)
    const page = await context.newPage()
    const requests = recordApiRequests(page)
    const writerBootstrap = await delayFirstWriterBootstrap(page)

    await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' })
    await waitForSmokeHook(page)
    await writerBootstrap.requested

    const coordinatorBeforeWriter = await page.evaluate(() =>
      window.__RISU_FASTIFY_BROWSER_SMOKE__!.getStartupCoordinatorSnapshot(),
    )
    expect(coordinatorBeforeWriter.observerShellEnabled).toBe(observerMode === 'enabled')
    expect(coordinatorBeforeWriter.capabilities.canMutate).toBe(false)
    expect(coordinatorBeforeWriter.capabilities.canGenerate).toBe(false)

    const observerShell = page.locator('[data-observer-shell]')
    if (observerMode === 'enabled') {
      await expect(observerShell).toBeVisible()
      expect(coordinatorBeforeWriter.capabilities.canRenderShell).toBe(true)
    } else {
      await expect(observerShell).toHaveCount(0)
      expect(coordinatorBeforeWriter.capabilities.canRenderShell).toBe(false)
    }

    writerBootstrap.release()
    await writerBootstrap.finished
    await page.unroute('**/api/v1/bootstrap')
    await page.evaluate(() =>
      window.__RISU_FASTIFY_BROWSER_SMOKE__!.waitForStartupMilestone('background-ready', 30_000),
    )

    const final = await page.evaluate(() => ({
      startup: window.__RISU_FASTIFY_BROWSER_SMOKE__!.getStartupSnapshot(),
      coordinator: window.__RISU_FASTIFY_BROWSER_SMOKE__!.getStartupCoordinatorSnapshot(),
      timeOrigin: performance.timeOrigin,
    }))
    expect(final.startup.phase).toBe('background-ready')
    expect(final.coordinator.capabilities).toMatchObject({
      canApplyRoutes: true,
      canMutate: true,
    })
    expect(final.startup.timestamps['observer-ready']).toBeLessThanOrEqual(final.startup.timestamps['writer-ready']!)

    const writerReadyAt = final.timeOrigin + (final.startup.timestamps['writer-ready'] ?? Number.POSITIVE_INFINITY)
    const chatReadyAt = final.timeOrigin + (final.startup.timestamps['chat-ready'] ?? Number.POSITIVE_INFINITY)
    const earlyRequests = {
      mutationsBeforeWriterReady: requests.filter(
        (request) =>
          request.method !== 'GET' &&
          request.path.startsWith('/api/v1/commands/') &&
          request.startedAtEpochMs < writerReadyAt,
      ).length,
      generationsBeforeChatReady: requests.filter(
        (request) =>
          request.method !== 'GET' &&
          (request.path.startsWith('/api/v1/generate/') || request.path.startsWith('/api/v1/generation-operations')) &&
          request.startedAtEpochMs < chatReadyAt,
      ).length,
    }
    expect(earlyRequests).toEqual({ mutationsBeforeWriterReady: 0, generationsBeforeChatReady: 0 })

    return {
      fixture,
      observerMode,
      observerVisibleBeforeWriter: observerMode === 'enabled',
      startup: final.startup,
      coordinator: final.coordinator,
      earlyRequests,
    }
  } finally {
    await context?.close().catch(() => undefined)
    await closeFastBootstrapHarness(harness)
  }
}

function recordApiRequests(page: Page): ApiRequestRecord[] {
  const requests: ApiRequestRecord[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/v1/')) return
    requests.push({ method: request.method(), path: url.pathname, startedAtEpochMs: Date.now() })
  })
  return requests
}

async function delayFirstWriterBootstrap(page: Page): Promise<{
  requested: Promise<void>
  release: () => void
  finished: Promise<void>
}> {
  const requested = deferred<void>()
  const release = deferred<void>()
  const finished = deferred<void>()
  let delayed = false
  await page.route('**/api/v1/bootstrap', async (route) => {
    const headers = await route.request().allHeaders()
    if (!delayed && headers['risu-writer-session']) {
      delayed = true
      requested.resolve()
      await release.promise
      await route.continue()
      finished.resolve()
      return
    }
    await route.continue()
  })
  return { requested: requested.promise, release: release.resolve, finished: finished.promise }
}

async function waitForSmokeHook(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__RISU_FASTIFY_BROWSER_SMOKE__)), { timeout: 20_000 })
    .toBe(true)
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function formatIntegrationArtifact(artifact: Phase7IntegrationArtifact): string {
  const lines = [
    'Phase 7 integration matrix',
    'fixture\tobserver\tobserver_before_writer\tobserver_ms\twriter_ms\tbackground_ms',
  ]
  for (const entry of artifact.startupRollout) {
    lines.push(
      [
        entry.fixture,
        entry.observerMode,
        entry.observerVisibleBeforeWriter,
        formatNumber(entry.startup.durationsFromEntry['observer-ready']),
        formatNumber(entry.startup.durationsFromEntry['writer-ready']),
        formatNumber(entry.startup.durationsFromEntry['background-ready']),
      ].join('\t'),
    )
  }
  return `${lines.join('\n')}\n`
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? '' : value.toFixed(2)
}
