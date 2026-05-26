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

let harness: Harness

test.beforeAll(async () => {
  harness = await startHarness()
  await importDatabase(harness.app, {
    didFirstSetup: true,
    formatversion: 5,
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
    modules: [],
    personas: [],
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
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.__NODE__))).toBe(true)
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__RISU_FASTIFY_BROWSER_SMOKE__)))
    .toBe(true)

  try {
    await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.waitForLoaded())
  } catch (err) {
    const bodyText = await page.locator('body').innerText().catch(() => '<body unavailable>')
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

  const initialProjection = await page.evaluate(
    () => window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot(),
  )
  expect(initialProjection?.useServerPromptAssembly).toBe(false)

  const commandResult = await page.evaluate(() =>
    window.__RISU_FASTIFY_BROWSER_SMOKE__!.patchRuntimeSettings({
      useServerPromptAssembly: true,
    }),
  )
  expect(commandResult).toMatchObject({
    status: 'ok',
    event: { type: 'settings.updated', resource: 'settings' },
  })

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot()
            .useServerPromptAssembly,
      ),
    )
    .toBe(true)

  expect(apiRequests).toContain('PATCH /api/v1/commands/settings/runtime')
  expect(apiRequests.filter((entry) => entry === 'GET /api/v1/bootstrap').length).toBeGreaterThan(
    1,
  )
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
