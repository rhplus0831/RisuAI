import { expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import type { FastifyInstance } from 'fastify'

// Lazy-projection Phase 6c — swipe persistence E2E. Proves the real Fastify-served
// browser reconstructs the reroll swipe buffer from the persisted alternate rows
// after a RELOAD (not just a disconnect), and that swiping back over the rebuilt
// buffer works under the live read-only projection guard.

interface Harness {
  app: FastifyInstance
  baseUrl: string
  dataDir: string
}

declare global {
  interface Window {
    __RISU_FASTIFY_BROWSER_SMOKE__?: {
      activeWriterHeaders: () => Record<string, string>
      getDatabaseSnapshot: () => Record<string, unknown>
      getRerollCandidates: () => string[]
      selectCharacter: (index: number) => void
      swipeRerollBack: () => Promise<void>
      waitForLoaded: () => Promise<void>
    }
  }
}

let harness: Harness

test.beforeAll(async () => {
  harness = await startHarness()
  await importDatabase(harness.app, rerollFixtureDatabase())
})

test.afterAll(async () => {
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

test('rerolled candidates survive a reload and stay swipe-recoverable (Phase 6c)', async ({
  page,
}) => {
  const diagnostics: string[] = []
  page.on('console', (m) => diagnostics.push(`console.${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => diagnostics.push(`pageerror: ${e.message}`))

  await page.goto(harness.baseUrl)
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__RISU_FASTIFY_BROWSER_SMOKE__)))
    .toBe(true)
  await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.waitForLoaded())

  // Open the character (bootstrap lands on the character list) → chat hydrates.
  await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.selectCharacter(0))

  // The open chat hydrates to [user, char 'old reply'].
  await expect
    .poll(() =>
      page.evaluate(() => {
        const snap = window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot()
        const chat = (
          snap.characters as Array<{ chats: Array<{ message: Array<{ data: string }> }> }>
        )[0].chats[0]
        return chat.message.map((m) => m.data)
      }),
    )
    .toEqual(['greet me', 'old reply'])

  // Drive a real server regenerate (echo provider) — the displaced 'old reply' AND
  // the new candidate both land in the reroll buffer (server alternate rows).
  const regenerateStatus = await page.evaluate(async () => {
    const headers = window.__RISU_FASTIFY_BROWSER_SMOKE__!.activeWriterHeaders()
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
    .poll(() => page.evaluate(() => Boolean(window.__RISU_FASTIFY_BROWSER_SMOKE__)))
    .toBe(true)
  await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.waitForLoaded())
  // Re-open the character after the reload (selection resets to the char list).
  await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.selectCharacter(0))

  // The reroll buffer is reconstructed: the displaced 'old reply' is recoverable
  // alongside the new active candidate.
  await expect
    .poll(() =>
      page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.getRerollCandidates()),
    )
    .toEqual(
      expect.arrayContaining([
        expect.stringContaining('old reply'),
        expect.stringContaining('rerolled reply'),
      ]),
    )
  const candidatesAfterReload = await page.evaluate(() =>
    window.__RISU_FASTIFY_BROWSER_SMOKE__!.getRerollCandidates(),
  )
  expect(candidatesAfterReload.length).toBe(2)

  // The active tail is the new candidate before swiping.
  const tailBefore = await page.evaluate(() => {
    const snap = window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot()
    const message = (snap.characters as Array<{ chats: Array<{ message: Array<{ data: string }> }> }>)[0]
      .chats[0].message
    return message.at(-1)!.data
  })
  expect(tailBefore).toContain('rerolled reply')

  // Swipe back over the rebuilt buffer (under the live projection guard) → the
  // prior candidate 'old reply' is recovered as the active tail.
  await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.swipeRerollBack())
  await expect
    .poll(() =>
      page.evaluate(() => {
        const snap = window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot()
        const message = (
          snap.characters as Array<{ chats: Array<{ message: Array<{ data: string }> }> }>
        )[0].chats[0].message
        return message.at(-1)!.data
      }),
    )
    .toContain('old reply')
})

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
    botPresets: [],
    loadouts: [],
    modules: [],
    username: 'User',
    selectedPersona: 0,
    personas: [{ name: 'User', icon: '', largePortrait: false, personaPrompt: '' }],
    plugins: [],
    pluginCustomStorage: {},
    language: 'en',
    loreBookToken: 8000,
    mainPrompt: 'MAIN',
    maxContext: 100_000,
    maxResponse: 50,
    useServerPromptAssembly: true,
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

async function importDatabase(app: FastifyInstance, database: Record<string, unknown>) {
  const imported = await app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    payload: { database },
  })
  expect(imported.statusCode).toBe(200)
}
