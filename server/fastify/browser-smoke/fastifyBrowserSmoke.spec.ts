import { devices, expect, test, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import type { FastifyInstance } from 'fastify'
import { setupBrowserSmokeAuth } from './auth.js'

interface Harness {
  app: FastifyInstance
  baseUrl: string
  dataDir: string
}

interface StorageAuditRecord {
  surface: string
  operation: string
  detail?: string
}

declare global {
  interface Window {
    __RISU_FASTIFY_STORAGE_WRITE_AUDIT__?: {
      records: StorageAuditRecord[]
    }
  }
}

let harness: Harness
let browserSmokeAssertion: string

test.beforeAll(async () => {
  harness = await startHarness()
  browserSmokeAssertion = await setupBrowserSmokeAuth(harness.app)
  await importDatabase(harness.app, browserSmokeAssertion, browserSmokeDatabase())
})

function browserSmokeDatabase(includeDragFixtures = false): Record<string, unknown> {
  return {
    version: 1,
    didFirstSetup: true,
    formatversion: 5,
    selectedCharID: 0,
    characterOrder: [],
    characters: [
      {
        chaId: 'char-smoke',
        type: 'character',
        name: 'Smoke Character',
        chats: [
          {
            id: 'chat-smoke',
            name: 'Smoke Chat',
            note: '',
            localLore: [],
            message: [],
          },
        ],
        chatPage: 0,
        customscript: [],
        firstMessage: '',
        globalLore: [],
        viewScreen: 'none',
        emotionImages: [],
      },
    ],
    botPresets: [],
    ...(includeDragFixtures
      ? {
          promptPresets: [
            { id: 'prompt-smoke-a', name: 'Prompt Smoke A', promptTemplate: [] },
            { id: 'prompt-smoke-b', name: 'Prompt Smoke B', promptTemplate: [] },
          ],
          promptPresetsId: 0,
          modelProfiles: [
            {
              id: 'profile-smoke-a',
              name: 'Profile Smoke A',
              providerId: 'debug-echo',
              modelId: 'debug-echo',
            },
            {
              id: 'profile-smoke-b',
              name: 'Profile Smoke B',
              providerId: 'debug-echo',
              modelId: 'debug-echo',
            },
          ],
          modelProfileOrder: [
            { kind: 'profile', profileId: 'profile-smoke-a' },
            { kind: 'profile', profileId: 'profile-smoke-b' },
          ],
          modelRoleProfiles: {},
          modelRuntimeDefaults: {},
          providerCredentials: [],
        }
      : {}),
    loadouts: [],
    modules: [],
    personas: [],
    plugins: [],
    pluginCustomStorage: {},
    language: 'en',
    loreBookToken: 8000,
    mainPrompt: '',
    streamGeminiThoughts: false,
  }
}

test.afterAll(async () => {
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

test('Fastify-served browser loads bootstrap, subscribes to events, and refreshes after a command', async ({
  page,
}) => {
  const apiRequests: string[] = []
  const resourceCacheRequests: Array<{ path: string; hashes: Record<string, unknown> }> = []
  const browserDiagnostics: string[] = []
  await page.addInitScript(() => {
    const audit: { records: StorageAuditRecord[] } = { records: [] }
    Object.defineProperty(window, '__RISU_FASTIFY_STORAGE_WRITE_AUDIT__', {
      configurable: true,
      value: audit,
    })

    const record = (surface: string, operation: string, detail?: unknown) => {
      audit.records.push({
        surface,
        operation,
        detail: typeof detail === 'string' ? detail : undefined,
      })
    }
    const patchMethod = (target: unknown, method: string, surface: string, operation = method, detailIndex = 0) => {
      const holder = target as Record<string, unknown> | undefined
      const original = holder?.[method]
      if (!holder || typeof original !== 'function') return
      holder[method] = function patchedStorageAuditMethod(this: unknown, ...args: unknown[]) {
        record(surface, operation, args[detailIndex])
        return original.apply(this, args)
      }
    }

    patchMethod(window.indexedDB, 'open', 'indexedDB')
    patchMethod(window.indexedDB, 'deleteDatabase', 'indexedDB')
    patchMethod((window as any).IDBDatabase?.prototype, 'createObjectStore', 'indexedDB')
    patchMethod((window as any).IDBDatabase?.prototype, 'deleteObjectStore', 'indexedDB')
    patchMethod((window as any).IDBObjectStore?.prototype, 'add', 'indexedDB')
    patchMethod((window as any).IDBObjectStore?.prototype, 'put', 'indexedDB')
    patchMethod((window as any).IDBObjectStore?.prototype, 'delete', 'indexedDB')
    patchMethod((window as any).IDBObjectStore?.prototype, 'clear', 'indexedDB')
    patchMethod(Object.getPrototypeOf(window.navigator.storage), 'getDirectory', 'opfs')
  })
  page.on('console', (message) => {
    browserDiagnostics.push(`console.${message.type()}: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    browserDiagnostics.push(`pageerror: ${error.message}`)
  })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/v1/')) {
      apiRequests.push(`${request.method()} ${url.pathname}`)
    }
    if (
      request.method() === 'POST' &&
      ['/api/v1/settings', '/api/v1/collections', '/api/v1/characters'].includes(url.pathname)
    ) {
      const body = request.postDataJSON() as { cache?: { hashes?: unknown } } | null
      if (body?.cache?.hashes && typeof body.cache.hashes === 'object') {
        resourceCacheRequests.push({ path: url.pathname, hashes: body.cache.hashes as Record<string, unknown> })
      }
    }
  })

  await page.goto(harness.baseUrl)

  await expect.poll(() => page.evaluate(() => Boolean(Reflect.get(globalThis, '__NODE__')))).toBe(false)
  await expect.poll(() => page.evaluate(() => Boolean(window.__RISU_FASTIFY_BROWSER_SMOKE__))).toBe(true)

  try {
    await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.waitForLoaded())
  } catch (err) {
    const bodyText = await page
      .locator('body')
      .innerText()
      .catch(() => '<body unavailable>')
    throw new Error(
      [
        err instanceof Error ? err.message : String(err),
        `body: ${bodyText.slice(0, 1000)}`,
        ...browserDiagnostics.slice(-20),
      ].join('\n'),
    )
  }
  await expect(page.locator('[data-char-id="char-smoke"]')).toBeVisible()

  await expect
    .poll(() => apiRequests.filter((entry) => entry === 'GET /api/v1/bootstrap').length)
    .toBeGreaterThanOrEqual(1)
  await expect
    .poll(() => apiRequests.filter((entry) => entry === 'GET /api/v1/events').length)
    .toBeGreaterThanOrEqual(1)
  for (const resource of ['settings', 'collections', 'characters']) {
    await expect
      .poll(() => apiRequests.filter((entry) => entry === `POST /api/v1/${resource}`).length)
      .toBeGreaterThanOrEqual(1)
  }

  const initialProjection = await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot())
  expect(initialProjection?.streamGeminiThoughts).toBe(false)
  expect(await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.assertDirectProjectionWriteRejected())).toBe(
    true,
  )

  const commandResult = await page.evaluate(() =>
    window.__RISU_FASTIFY_BROWSER_SMOKE__!.patchRuntimeSettings({
      streamGeminiThoughts: true,
    }),
  )
  expect(commandResult).toMatchObject({
    status: 'ok',
    event: { type: 'settings.updated', resource: 'settings' },
  })

  const apiRouteResults = await page.evaluate(async () => {
    const activeWriterHeaders = await window.__RISU_FASTIFY_BROWSER_SMOKE__!.activeWriterHeaders()
    const generated = await fetch('/api/v1/generate/completion', {
      body: JSON.stringify({
        provider: 'echo',
        model: 'echo_model',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: { echo: { message: 'pong', delayMs: 0 } },
      }),
      headers: { ...activeWriterHeaders, 'content-type': 'application/json' },
      method: 'POST',
    })
    const generatedBody = await generated.json()

    const chunks = await fetch('/api/v1/memory/chunks/chat-smoke', {
      headers: activeWriterHeaders,
    })
    const summaries = await fetch('/api/v1/memory/summaries/chat-smoke', {
      headers: activeWriterHeaders,
    })
    const exported = await fetch('/api/v1/export/risusave', {
      headers: activeWriterHeaders,
    })
    const exportedBytes = await exported.blob()
    const importForm = new FormData()
    importForm.append('file', exportedBytes, 'database.risu')
    const imported = await fetch('/api/v1/import/risusave', {
      body: importForm,
      headers: activeWriterHeaders,
      method: 'POST',
    })
    const importedBody = await imported.json()
    const bundle = await fetch('/api/v1/export/bundle', { headers: activeWriterHeaders })

    const uploaded = await fetch('/api/v1/assets', {
      body: new Uint8Array([1, 2, 3]),
      headers: { ...activeWriterHeaders, 'content-type': 'image/png' },
      method: 'POST',
    })
    const uploadedBody = await uploaded.json()
    const asset = await fetch(`/api/v1/assets/${uploadedBody.assetId}`, {
      headers: activeWriterHeaders,
    })

    return {
      asset: asset.status,
      bundle: bundle.status,
      chunks: chunks.status,
      exported: exported.status,
      generated: generated.status,
      generatedBody,
      imported: imported.status,
      importedBody,
      summaries: summaries.status,
      uploaded: uploaded.status,
    }
  })
  expect(apiRouteResults).toMatchObject({
    asset: 200,
    bundle: 200,
    chunks: 200,
    exported: 200,
    generated: 200,
    generatedBody: { type: 'success', result: 'pong' },
    imported: 200,
    importedBody: { event: { type: 'state.imported', resource: 'state' } },
    summaries: 200,
    uploaded: 201,
  })

  await expect
    .poll(() => page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot().streamGeminiThoughts))
    .toBe(true)

  expect(apiRequests).toContain('PATCH /api/v1/commands/settings/runtime')
  expect(apiRequests).toContain('POST /api/v1/assets')
  expect(apiRequests).toContain('POST /api/v1/generate/completion')
  expect(apiRequests).toContain('GET /api/v1/export/risusave')
  expect(apiRequests).toContain('GET /api/v1/export/bundle')
  expect(apiRequests).toContain('POST /api/v1/import/risusave')
  expect(apiRequests).toContain('GET /api/v1/memory/chunks/chat-smoke')
  expect(apiRequests).toContain('GET /api/v1/memory/summaries/chat-smoke')
  for (const resource of ['settings', 'collections', 'characters']) {
    const path = `/api/v1/${resource}`
    await expect.poll(() => resourceCacheRequests.filter((entry) => entry.path === path).length).toBeGreaterThan(1)
    const latest = resourceCacheRequests.filter((entry) => entry.path === path).at(-1)
    expect(
      Object.values(latest?.hashes ?? {}).some(
        (hashes) =>
          Array.isArray(hashes) && hashes.some((hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)),
      ),
    ).toBe(true)
  }
  expect(apiRequests.filter((entry) => /^((GET)|(POST)) \/api\/v1\/storage\//.test(entry))).toEqual([])
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window.__RISU_FASTIFY_STORAGE_WRITE_AUDIT__?.records ?? []).filter((record) => record.surface !== 'indexedDB'),
      ),
    )
    .toEqual([])
})

test('core chat controls and blocking alerts remain accessible across responsive viewports', async ({ page }) => {
  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto(harness.baseUrl)
    await expect.poll(() => page.evaluate(() => Boolean(window.__RISU_FASTIFY_BROWSER_SMOKE__))).toBe(true)
    await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.waitForLoaded())
    await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.selectCharacter(0))

    const chatRow = page.locator('[data-risu-chat-id="chat-smoke"]').first()
    const mobileRecentChat = page.getByRole('button', { name: /Open most recent chat Smoke Chat/ })
    await expect.poll(async () => (await chatRow.isVisible()) || (await mobileRecentChat.isVisible())).toBe(true)
    if (await chatRow.isVisible()) {
      await chatRow.locator('button[data-risu-chat-action="select"]').click()
    } else {
      await mobileRecentChat.click()
    }

    const composer = page.getByTestId('default-chat-composer')
    const composerDock = page.locator('[data-default-chat-composer-dock]')
    const transcript = page.locator('[data-default-chat-transcript]')
    await expect(composer).toBeVisible()
    await expect(composerDock).toBeVisible()
    await expect(transcript).toBeVisible()
    await expect(composerDock.locator('[data-testid="default-chat-composer"]')).toHaveCount(1)
    await expect(transcript.locator('[data-testid="default-chat-composer"]')).toHaveCount(0)
    await expect(composer).toHaveAccessibleName(/.+/)
    await expect(page.getByTestId('default-chat-send-button')).toHaveAccessibleName(/.+/)
    await expect(page.getByTestId('default-chat-menu-button')).toHaveAccessibleName(/.+/)
    await expect(page.locator('button button')).toHaveCount(0)

    await composer.focus()
    await expect(page.locator('html')).toHaveAttribute('data-risu-visual-viewport-active', 'true')
    const chatGeometry = await page.evaluate(() => {
      const dock = document.querySelector<HTMLElement>('[data-default-chat-composer-dock]')
      const transcriptElement = document.querySelector<HTMLElement>('[data-default-chat-transcript]')
      const shell = document.querySelector<HTMLElement>('[data-risu-visual-viewport-shell]')
      if (!dock || !transcriptElement || !shell) return null
      const dockRect = dock.getBoundingClientRect()
      const transcriptRect = transcriptElement.getBoundingClientRect()
      const shellRect = shell.getBoundingClientRect()
      return {
        dockBottom: dockRect.bottom,
        shellBottom: shellRect.bottom,
        transcriptBottom: transcriptRect.bottom,
        transcriptOverflowY: getComputedStyle(transcriptElement).overflowY,
        dockTop: dockRect.top,
      }
    })
    expect(chatGeometry).not.toBeNull()
    expect(chatGeometry!.transcriptOverflowY).toBe('auto')
    expect(Math.abs(chatGeometry!.dockBottom - chatGeometry!.shellBottom)).toBeLessThanOrEqual(1)
    expect(chatGeometry!.transcriptBottom).toBeLessThanOrEqual(chatGeometry!.dockTop + 1)
    await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.showAlert('Accessibility smoke alert'))
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Accessibility smoke alert')
    await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Tab')
    await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true)
    await expect(page).toHaveScreenshot(`blocking-alert-${viewport.name}.png`, {
      animations: 'disabled',
      caret: 'hide',
    })
    await page.getByRole('button', { name: 'OK' }).click()
    await expect(dialog).toBeHidden()
    await expect(composer).toBeFocused()

    await expect(page).toHaveScreenshot(`core-chat-${viewport.name}.png`, {
      animations: 'disabled',
      caret: 'hide',
    })
  }
})

test('prompt presets and model profiles reorder from an immediate mobile touch drag', async ({ browser }) => {
  test.setTimeout(60_000)
  await importDatabase(harness.app, browserSmokeAssertion, browserSmokeDatabase(true))
  const context = await browser.newContext({ ...devices['Pixel 7'] })
  const page = await context.newPage()

  try {
    await page.goto(`${harness.baseUrl}/settings/prompt-settings`)
    await waitForBrowserSmokeLoaded(page)

    await page.getByRole('button', { name: 'Prompt Smoke A', exact: true }).click()
    const promptRows = page.locator('[data-risu-generation-picker-row][data-risu-picker-kind="prompt"]')
    await expect(promptRows).toHaveCount(2)
    const promptReorder = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/commands/prompt-presets/reorder',
    )
    await dragByTouch(page, promptRows.nth(0).locator('[data-risu-preset-drag-handle]'), promptRows.nth(1))
    expect((await promptReorder).ok()).toBe(true)
    await expect
      .poll(() => promptRows.evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.risuRowId)))
      .toEqual(['prompt-smoke-b', 'prompt-smoke-a'])

    await page.goto(`${harness.baseUrl}/settings/model`)
    await waitForBrowserSmokeLoaded(page)
    await page.getByRole('button', { name: 'Profiles', exact: true }).click()
    const profileRows = page.locator('[data-model-profile-row]')
    await expect(profileRows).toHaveCount(2)
    const profileReorder = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/commands/model-profiles/reorder',
    )
    await dragByTouch(page, profileRows.nth(0).locator('[data-model-profile-drag-handle]'), profileRows.nth(1))
    expect((await profileReorder).ok()).toBe(true)
    await expect
      .poll(() => profileRows.evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.profileId)))
      .toEqual(['profile-smoke-b', 'profile-smoke-a'])
  } finally {
    await context.close()
  }
})

async function waitForBrowserSmokeLoaded(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => Boolean(window.__RISU_FASTIFY_BROWSER_SMOKE__))).toBe(true)
  await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.waitForLoaded())
}

async function dragByTouch(page: Page, source: Locator, target: Locator): Promise<void> {
  await source.scrollIntoViewIfNeeded()
  await target.scrollIntoViewIfNeeded()
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('Touch drag target is not visible')

  const start = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 }
  const end = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height * 0.8 }
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...start, id: 1 }],
    })
    for (let step = 1; step <= 8; step += 1) {
      const progress = step / 8
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: start.x + (end.x - start.x) * progress,
            y: start.y + (end.y - start.y) * progress,
            id: 1,
          },
        ],
      })
      await page.waitForTimeout(16)
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await session.detach()
  }
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-browser-smoke-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      importMaxBytes: Number.POSITIVE_INFINITY,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
      staticRoot: path.resolve('dist'),
    },
    memoryWorker: false,
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Fastify browser smoke harness did not bind to a TCP port')
  }
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    dataDir,
  }
}

async function importDatabase(app: FastifyInstance, auth: string, database: Record<string, unknown>) {
  // The import route is writer-guarded: once an earlier test's page has
  // registered a writer session, a header-less inject is rejected with 423.
  // Claim the lease the way a freshly booted tab would (bootstrap registers
  // the requested writer session), then import under that same session.
  const writerSession = `browser-smoke-import-${randomUUID()}`
  const registered = await app.inject({
    method: 'GET',
    url: '/api/v1/bootstrap',
    headers: { 'risu-auth': auth, 'risu-writer-session': writerSession },
  })
  expect(registered.statusCode).toBe(200)
  const imported = await app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': auth, 'risu-writer-session': writerSession },
    payload: { database },
  })
  expect(imported.statusCode).toBe(200)
}
