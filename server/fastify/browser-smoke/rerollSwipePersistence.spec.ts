import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import type { FastifyInstance } from 'fastify'
import { setupBrowserSmokeAuth } from './auth.js'

// Swipe persistence E2E. Proves the real Fastify-served browser reconstructs the
// reroll swipe buffer from persisted alternate rows after a reload, and that
// swiping back over the rebuilt buffer works under the live read-only projection guard.

interface Harness {
  app: FastifyInstance
  baseUrl: string
  dataDir: string
}

declare global {
  interface Window {
    __RISU_FASTIFY_BROWSER_SMOKE__?: {
      activeWriterHeaders: () => Promise<Record<string, string>>
      getDatabaseSnapshot: () => Record<string, unknown>
      getRerollCandidates: () => string[]
      refreshActiveChatMessages: () => Promise<void>
      selectCharacter: (index: number) => void
      swipeRerollBack: () => Promise<void>
      waitForLoaded: () => Promise<void>
    }
  }
}

let harness: Harness

test.beforeAll(async () => {
  harness = await startHarness()
  const assertion = await setupBrowserSmokeAuth(harness.app)
  await importDatabase(harness.app, assertion, rerollFixtureDatabase())
})

test.afterAll(async () => {
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

test('rerolled candidates survive a reload and stay swipe-recoverable (Phase 6c)', async ({ page }) => {
  const diagnostics: string[] = []
  page.on('console', (m) => diagnostics.push(`console.${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => diagnostics.push(`pageerror: ${e.message}`))

  await page.addInitScript(() => localStorage.setItem('tos4', 'true'))
  await page.goto(harness.baseUrl)
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__RISU_FASTIFY_BROWSER_SMOKE__)), {
      timeout: 15_000,
    })
    .toBe(true)
  await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.waitForLoaded())
  await expectLoadedCharacterVisible(page)
  await markRerollChatGenerationSettingsReady(page)

  // Ensure the fixture character is open, then let the chat hydrate.
  await openFixtureChat(page)
  await expectVisibleChatRow(page, 0, 'greet me')
  await expectVisibleChatRow(page, 1, 'old reply')

  // The open chat hydrates to [user, char 'old reply'].
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const snap = window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot()
          const chat = (snap.characters as Array<{ chats: Array<{ message: Array<{ data: string }> }> }>)[0].chats[0]
          return chat.message.map((m) => m.data)
        }),
      { timeout: 15_000 },
    )
    .toEqual(['greet me', 'old reply'])

  // Drive a real server regenerate (echo provider) — the displaced 'old reply' AND
  // the new candidate both land in the reroll buffer (server alternate rows).
  const regenerateStatus = await page.evaluate(async () => {
    const headers = await window.__RISU_FASTIFY_BROWSER_SMOKE__!.activeWriterHeaders()
    const res = await fetch('/api/v1/generate/chat', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: 'chat-1',
        characterId: 'char-1',
        mode: 'regenerate',
        regenerateMessageId: 'msg-char-1',
      }),
    })
    await res.text() // drain the SSE stream so the persist completes
    return res.status
  })
  expect(regenerateStatus, diagnostics.slice(-15).join('\n')).toBe(200)

  // RELOAD: the buffer must be rebuilt purely from the persisted projection.
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__RISU_FASTIFY_BROWSER_SMOKE__)), {
      timeout: 15_000,
    })
    .toBe(true)
  await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.waitForLoaded())
  await expectLoadedCharacterVisible(page)
  // Ensure the fixture character is open after the reload.
  await openFixtureChat(page)
  await expectVisibleChatRow(page, 0, 'greet me')
  await expectVisibleChatRow(page, 1, 'rerolled reply')
  await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.refreshActiveChatMessages())

  // The reroll buffer is reconstructed: the displaced 'old reply' is recoverable
  // alongside the new active candidate.
  await expect
    .poll(() => page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.getRerollCandidates()), {
      timeout: 15_000,
    })
    .toEqual(expect.arrayContaining([expect.stringContaining('old reply'), expect.stringContaining('rerolled reply')]))
  const candidatesAfterReload = await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.getRerollCandidates())
  expect(candidatesAfterReload.length).toBe(2)

  // The active tail is the new candidate before swiping.
  const tailBefore = await page.evaluate(() => {
    const snap = window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot()
    const message = (snap.characters as Array<{ chats: Array<{ message: Array<{ data: string }> }> }>)[0].chats[0]
      .message
    return message.at(-1)!.data
  })
  expect(tailBefore).toContain('rerolled reply')

  // Swipe back over the rebuilt buffer (under the live projection guard) → the
  // prior candidate 'old reply' is recovered as the active tail.
  await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.swipeRerollBack())
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const snap = window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot()
          const message = (snap.characters as Array<{ chats: Array<{ message: Array<{ data: string }> }> }>)[0].chats[0]
            .message
          return message.at(-1)?.data ?? ''
        }),
      { timeout: 15_000 },
    )
    .toContain('old reply')
  await expectVisibleChatRow(page, 1, 'old reply')
})

async function expectLoadedCharacterVisible(page: Page): Promise<void> {
  await expect(page.locator('[data-char-id="char-1"]')).toBeVisible()
}

async function openFixtureChat(page: Page): Promise<void> {
  await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.selectCharacter(0))
  const fixtureEntry = page
    .locator(
      '.default-chat-screen .risu-chat[data-chat-index="0"], button[data-risu-chat-idx][data-risu-chat-id="chat-1"]',
    )
    .first()
  await expect(fixtureEntry).toBeVisible({ timeout: 15_000 })
  const needsOpen = await fixtureEntry.evaluate((node) =>
    node.matches('button[data-risu-chat-idx][data-risu-chat-id="chat-1"]'),
  )
  if (needsOpen) {
    await fixtureEntry.click()
  }
}

async function expectVisibleChatRow(page: Page, index: number, text: string): Promise<void> {
  const row = page.locator(`.default-chat-screen .risu-chat[data-chat-index="${index}"]`)
  await expect(row).toBeVisible()
  await expect(row).toContainText(text)
}

async function markRerollChatGenerationSettingsReady(page: Page): Promise<void> {
  const result = await page.evaluate(async () => {
    const headers = await window.__RISU_FASTIFY_BROWSER_SMOKE__!.activeWriterHeaders()
    const bootstrap = await fetch('/api/v1/bootstrap', { headers })
    const bootstrapBody = (await bootstrap.json()) as { revision?: unknown }
    const res = await fetch('/api/v1/commands/chats/chat-1/generation-settings', {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        baseRevision: bootstrapBody.revision,
        generationSettings: {
          configured: true,
          personaId: 'persona-reroll-smoke',
          modelPresetId: 'model-preset-reroll-smoke',
          promptPresetId: 'preset-reroll-smoke',
          jailbreakToggle: false,
          sidebarToggles: {},
        },
      }),
    })
    return { body: await res.json(), status: res.status }
  })
  expect(result, JSON.stringify(result.body)).toMatchObject({ status: 200 })
}

function rerollFixtureDatabase(): Record<string, unknown> {
  return {
    version: 1,
    didFirstSetup: true,
    formatversion: 5,
    currentChar: 0,
    selectedCharID: 0,
    characterOrder: [],
    characters: [
      {
        chaId: 'char-1',
        type: 'character',
        name: 'Reroll Char',
        desc: 'DESC',
        utilityBot: false,
        chatPage: 0,
        firstMessage: 'Greetings.',
        customscript: [],
        globalLore: [],
        viewScreen: 'none',
        emotionImages: [],
        chats: [
          {
            id: 'chat-1',
            name: 'Chat',
            note: '',
            localLore: [],
            message: [
              { role: 'user', data: 'greet me', chatId: 'msg-user-1' },
              { role: 'char', data: 'old reply', chatId: 'msg-char-1', saying: 'char-1' },
            ],
          },
        ],
      },
    ],
    formatingOrder: ['main', 'description', 'chats'],
    promptSettings: {
      assistantPrefill: '',
      postEndInnerFormat: '',
      sendChatAsSystem: false,
      sendName: false,
      utilOverride: false,
    },
    modelPresets: [{ id: 'model-preset-reroll-smoke', name: 'Reroll Smoke Model Preset' }],
    promptPresets: [{ id: 'preset-reroll-smoke', name: 'Reroll Smoke Prompt Preset' }],
    loadouts: [],
    modules: [],
    username: 'User',
    selectedPersona: 0,
    personas: [
      {
        id: 'persona-reroll-smoke',
        name: 'User',
        icon: '',
        largePortrait: false,
        personaPrompt: '',
      },
    ],
    plugins: [],
    pluginCustomStorage: {},
    language: 'en',
    loreBookToken: 8000,
    mainPrompt: 'MAIN',
    maxContext: 100_000,
    maxResponse: 50,
    aiModel: 'echo_model',
    echoMessage: 'rerolled reply',
    echoDelay: 0,
  }
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-reroll-smoke-'))
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
    throw new Error('Fastify reroll smoke harness did not bind to a TCP port')
  }
  return { app, baseUrl: `http://127.0.0.1:${address.port}`, dataDir }
}

async function importDatabase(app: FastifyInstance, auth: string, database: Record<string, unknown>) {
  const imported = await app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': auth },
    payload: { database },
  })
  expect(imported.statusCode).toBe(200)
}
