import { expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import type { FastifyInstance } from 'fastify'

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
    __RISU_FASTIFY_BROWSER_SMOKE__?: {
      assertDirectProjectionWriteRejected: () => boolean
      activeWriterHeaders: () => Record<string, string>
      getDatabaseSnapshot: () => Record<string, unknown>
      patchRuntimeSettings: (patch: Record<string, unknown>) => Promise<Record<string, unknown>>
      waitForLoaded: () => Promise<void>
    }
  }
}

let harness: Harness

test.beforeAll(async () => {
  harness = await startHarness()
  await importDatabase(harness.app, {
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
        chats: [],
        chatPage: 0,
        customscript: [],
        firstMessage: '',
        globalLore: [],
        viewScreen: 'none',
        emotionImages: [],
      },
    ],
    botPresets: [],
    loadouts: [],
    modules: [],
    personas: [],
    plugins: [],
    pluginCustomStorage: {},
    language: 'en',
    loreBookToken: 8000,
    mainPrompt: '',
    useServerPromptAssembly: false,
  })
})

test.afterAll(async () => {
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

test('Fastify-served browser loads bootstrap, subscribes to events, and refreshes after a command', async ({
  page,
}) => {
  const apiRequests: string[] = []
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
    const patchMethod = (
      target: unknown,
      method: string,
      surface: string,
      operation = method,
      detailIndex = 0,
    ) => {
      const holder = target as Record<string, unknown> | undefined
      const original = holder?.[method]
      if (typeof original !== 'function') return
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
  })

  await page.goto(harness.baseUrl)

  await expect.poll(() => page.evaluate(() => Boolean(globalThis.__FASTIFY__))).toBe(true)
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.__NODE__))).toBe(false)
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__RISU_FASTIFY_BROWSER_SMOKE__)))
    .toBe(true)

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

  await expect
    .poll(() => apiRequests.filter((entry) => entry === 'GET /api/v1/bootstrap').length)
    .toBeGreaterThanOrEqual(1)
  await expect
    .poll(() => apiRequests.filter((entry) => entry === 'GET /api/v1/events').length)
    .toBeGreaterThanOrEqual(1)

  const initialProjection = await page.evaluate(() =>
    window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot(),
  )
  expect(initialProjection?.useServerPromptAssembly).toBe(false)
  expect(
    await page.evaluate(() =>
      window.__RISU_FASTIFY_BROWSER_SMOKE__!.assertDirectProjectionWriteRejected(),
    ),
  ).toBe(true)

  const commandResult = await page.evaluate(() =>
    window.__RISU_FASTIFY_BROWSER_SMOKE__!.patchRuntimeSettings({
      useServerPromptAssembly: true,
    }),
  )
  expect(commandResult).toMatchObject({
    status: 'ok',
    event: { type: 'settings.updated', resource: 'settings' },
  })

  const apiRouteResults = await page.evaluate(async () => {
    const generated = await fetch('/api/v1/generate/completion', {
      body: JSON.stringify({
        provider: 'echo',
        model: 'echo_model',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: { echo: { message: 'pong', delayMs: 0 } },
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const generatedBody = await generated.json()

    const chunks = await fetch('/api/v1/memory/chunks/chat-smoke')
    const summaries = await fetch('/api/v1/memory/summaries/chat-smoke')
    const exported = await fetch('/api/v1/export/risusave')
    const exportedBytes = await exported.blob()
    const importForm = new FormData()
    const activeWriterHeaders = window.__RISU_FASTIFY_BROWSER_SMOKE__!.activeWriterHeaders()
    importForm.append('file', exportedBytes, 'database.risu')
    const imported = await fetch('/api/v1/import/risusave', {
      body: importForm,
      headers: activeWriterHeaders,
      method: 'POST',
    })
    const importedBody = await imported.json()
    const bundle = await fetch('/api/v1/export/bundle')

    const uploaded = await fetch('/api/v1/assets', {
      body: new Uint8Array([1, 2, 3]),
      headers: { ...activeWriterHeaders, 'content-type': 'image/png' },
      method: 'POST',
    })
    const uploadedBody = await uploaded.json()
    const asset = await fetch(`/api/v1/assets/${uploadedBody.assetId}`)

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
    .poll(() =>
      page.evaluate(
        () => window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot().useServerPromptAssembly,
      ),
    )
    .toBe(true)

  expect(apiRequests).toContain('PATCH /api/v1/commands/settings/runtime')
  expect(apiRequests).toContain('POST /api/v1/assets')
  expect(apiRequests).toContain('POST /api/v1/generate/completion')
  expect(apiRequests).toContain('GET /api/v1/export/risusave')
  expect(apiRequests).toContain('GET /api/v1/export/bundle')
  expect(apiRequests).toContain('POST /api/v1/import/risusave')
  expect(apiRequests).toContain('GET /api/v1/memory/chunks/chat-smoke')
  expect(apiRequests).toContain('GET /api/v1/memory/summaries/chat-smoke')
  expect(apiRequests.filter((entry) => entry === 'GET /api/v1/bootstrap').length).toBeGreaterThan(1)
  expect(apiRequests.filter((entry) => /^((GET)|(POST)) \/api\/v1\/storage\//.test(entry))).toEqual(
    [],
  )
  await expect
    .poll(() => page.evaluate(() => window.__RISU_FASTIFY_STORAGE_WRITE_AUDIT__?.records ?? []))
    .toEqual([])
})

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-browser-smoke-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
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

async function importDatabase(app: FastifyInstance, database: Record<string, unknown>) {
  const imported = await app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    payload: { database },
  })
  expect(imported.statusCode).toBe(200)
}
