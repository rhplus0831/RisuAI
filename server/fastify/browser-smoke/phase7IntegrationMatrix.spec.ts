import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { buildLargeCorpusFixture } from '../../../src/ts/__tests__/largeCorpusFixture.js'
import {
  PLAYGROUND_RESOURCE_SURFACE_BY_INDEX,
  SETTINGS_RESOURCE_SURFACE_BY_INDEX,
  resolveResourceRequirements,
  resourceSurfacesForRoute,
  type ResourceRequirement,
} from '../../../src/ts/server/resourceManifest.js'
import { parseRoute, routeKey, routePathFromState, type AppRoute } from '../../../src/ts/routerRoute.js'
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
  directLinks: DirectLinkCase[]
}

interface DirectLinkCase {
  path: string
  requestedRouteKey: string
  finalRouteKey: string
  surfaces: string[]
  requiredPaths: string[]
  requestedPaths: string[]
}

const outputDir = path.resolve('fast-bootstrap-results')
const artifact: Phase7IntegrationArtifact = { schemaVersion: 1, startupRollout: [], directLinks: [] }

test.setTimeout(240_000)

test.afterAll(async ({}, testInfo) => {
  const machineOutput = `${JSON.stringify(artifact, null, 2)}\n`
  const humanOutput = formatIntegrationArtifact(artifact)
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(path.join(outputDir, 'phase7-integration.json'), machineOutput)
  fs.writeFileSync(path.join(outputDir, 'phase7-integration.txt'), humanOutput)
  await testInfo.attach('phase7-integration.json', { body: machineOutput, contentType: 'application/json' })
  await testInfo.attach('phase7-integration.txt', { body: humanOutput, contentType: 'text/plain' })
})

test('Phase 7 startup rollout matrix proves flag-off and flag-on boundaries on small and large fixtures', async ({
  browser,
}) => {
  const startupRollout: RolloutStartupCase[] = []
  for (const fixture of ['small', 'large'] as const) {
    const database = fixture === 'small' ? smallFastBootstrapFixture() : buildLargeCorpusFixture().database
    for (const observerMode of ['disabled', 'enabled'] as const) {
      startupRollout.push(await runRolloutStartupCase(browser, fixture, database, observerMode))
    }
  }

  artifact.startupRollout = startupRollout
})

test('Phase 7 direct-link matrix hydrates every route family from an empty browser and resource cache', async ({
  browser,
}) => {
  const harness = await startFastBootstrapHarness(smallFastBootstrapFixture(), {
    temporaryDirectoryPrefix: 'risu-phase7-direct-links-',
  })
  const context = await browser.newContext()
  try {
    await setObserverShellMode(context, 'disabled')
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    const pageErrors: string[] = []
    const requestedPaths = new Set<string>()
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/v1/')) requestedPaths.add(url.pathname)
    })

    const cases = directLinkCases()
    expect(new Set(cases.map((entry) => routeKey(entry.route))).size).toBe(cases.length)
    expect(new Set(cases.flatMap((entry) => resourceSurfacesForRoute(entry.route)))).toEqual(
      new Set([
        'shared:app-shell',
        'shared:settings-shell',
        'shared:playground-shell',
        'route:home',
        'route:grid',
        'route:inlay',
        'route:not-found',
        'route:character',
        'route:character-chat',
        'runtime:chat-generation',
        ...Object.values(SETTINGS_RESOURCE_SURFACE_BY_INDEX),
        ...Object.values(PLAYGROUND_RESOURCE_SURFACE_BY_INDEX),
      ]),
    )

    for (const entry of cases) {
      if (page.url().startsWith(harness.baseUrl)) {
        await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.clearResourceCache())
      }
      await cdp.send('Network.clearBrowserCache')
      pageErrors.length = 0
      requestedPaths.clear()

      await page.goto(`${harness.baseUrl}${entry.path}`, { waitUntil: 'domcontentloaded' })
      await waitForSmokeHook(page)
      await page.evaluate(() =>
        window.__RISU_FASTIFY_BROWSER_SMOKE__!.waitForStartupMilestone('background-ready', 30_000),
      )
      const finalRoute = entry.finalRoute ?? entry.route
      await expect
        .poll(() => page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.getRouteResourceLoadState()), {
          message: `${entry.path} did not finish its route resource load`,
        })
        .toMatchObject({ routeKey: routeKey(finalRoute), status: 'ready', error: null })
      expect(await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.getCurrentRoute())).toEqual(finalRoute)
      expect(pageErrors).toEqual([])

      const requiredPaths = requiredResourcePaths(entry.route)
      expect(requestedPaths).toContain('/api/v1/resources/shell')
      for (const requiredPath of requiredPaths) {
        expect(requestedPaths, `${entry.path} did not request ${requiredPath}`).toContain(requiredPath)
      }
      artifact.directLinks.push({
        path: entry.path,
        requestedRouteKey: routeKey(entry.route),
        finalRouteKey: routeKey(finalRoute),
        surfaces: resourceSurfacesForRoute(entry.route),
        requiredPaths,
        requestedPaths: [...requestedPaths].sort(),
      })
    }
    await cdp.detach()
  } finally {
    await context.close().catch(() => undefined)
    await closeFastBootstrapHarness(harness)
  }
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
  lines.push('', 'Direct links', 'path\trequested_route_key\tfinal_route_key\tsurfaces\trequired_paths')
  for (const entry of artifact.directLinks) {
    lines.push(
      [
        entry.path,
        entry.requestedRouteKey,
        entry.finalRouteKey,
        entry.surfaces.join(','),
        entry.requiredPaths.join(','),
      ].join('\t'),
    )
  }
  return `${lines.join('\n')}\n`
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? '' : value.toFixed(2)
}

function directLinkCases(): Array<{ path: string; route: AppRoute; finalRoute?: AppRoute }> {
  const stateDefaults = {
    currentRouteKind: 'home' as const,
    settingsOpen: false,
    settingsMenuIndex: -1,
    selectedCharID: -1,
    playgroundStore: 0,
  }
  const settings = Object.keys(SETTINGS_RESOURCE_SURFACE_BY_INDEX).map(Number)
  const playground = Object.keys(PLAYGROUND_RESOURCE_SURFACE_BY_INDEX).map(Number)
  const paths = [
    '/',
    '/grid',
    '/inlay',
    '/phase7-not-found',
    '/character/fast-bootstrap-small-character',
    '/character/fast-bootstrap-small-character/fast-bootstrap-small-chat',
    ...settings.map((settingsMenuIndex) =>
      routePathFromState({ ...stateDefaults, settingsOpen: true, settingsMenuIndex }),
    ),
    ...playground.map((playgroundStore) =>
      playgroundStore === 14 ? '/playground/inlays' : routePathFromState({ ...stateDefaults, playgroundStore }),
    ),
  ]
  return paths.map((path) => ({
    path,
    route: parseRoute(path),
    ...(path === '/phase7-not-found' ? { finalRoute: parseRoute('/') } : {}),
    ...(path === '/playground/inlays' ? { finalRoute: parseRoute('/inlay') } : {}),
  }))
}

function requiredResourcePaths(route: AppRoute): string[] {
  const requirements = resolveResourceRequirements(
    resourceSurfacesForRoute(route).filter((surface) => surface !== 'shared:app-shell'),
  )
  return [...new Set(requirements.flatMap((requirement) => requirementResourcePaths(requirement, route)))].sort()
}

function requirementResourcePaths(requirement: ResourceRequirement, route: AppRoute): string[] {
  switch (requirement.kind) {
    case 'settings-group':
      return [`/api/v1/settings/${requirement.group}`]
    case 'collection':
      return [`/api/v1/collections/${requirement.collection}`]
    case 'standalone-setting':
      return [`/api/v1/resources/settings/${requirement.setting}`]
    case 'projection':
      switch (requirement.projection) {
        case 'character-summaries':
        case 'character-selection':
        case 'selected-prompt-template':
          return []
        case 'selected-character':
          return route.kind === 'character' ? [`/api/v1/characters/${encodeURIComponent(route.chaId)}`] : []
        case 'selected-chat':
          return route.kind === 'character' && route.chatId
            ? [`/api/v1/chats/${encodeURIComponent(route.chatId)}/messages`]
            : []
        case 'inlay-catalog':
          return ['/api/v1/inlay-assets']
      }
  }
}
