import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import type { FastifyInstance } from 'fastify'
import { setupBrowserSmokeAuth } from './auth.js'

// Phase 0 Tier-2 DOM-oracle journeys for the UI/UX behavioral audit
// (docs/AUDIT-PLAN.md §6). These drive real clicks in the real Fastify-served
// browser, assert on rendered DOM (page.locator), and cross-check the store via
// getDatabaseSnapshot() only to classify.
//
//   - Journey 1: switch chats by clicking sidebar rows -> the generation picker
//     repaints the newly active chat's prompt preset id.
//   - Journey 2 (settle): toggle a sidebar checkbox -> the flip survives the
//     command + projection refreeze (not just the optimistic paint).
//   - Journey 3 (GATE): open the "character" sidebar tab, then save generation
//     settings (a DB projection refreeze). The tab must stay on "character".
//     This is the Tier-2 acceptance-gate probe: reverting only the
//     `untrack(applyRouteToStores)` hunk from 09eae20d3 turns Journey 3 RED
//     (the refreeze-triggered route re-application resets botMakerMode), while
//     the store snapshot stays correct. See docs/audit-result/phase0-acceptance-gate.md.

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
      selectCharacter: (index: number) => void
      waitForLoaded: () => Promise<void>
    }
  }
}

let harness: Harness

test.beforeAll(async () => {
  harness = await startHarness()
  const assertion = await setupBrowserSmokeAuth(harness.app)
  await importDatabase(harness.app, assertion, phase0FixtureDatabase())
})

test.afterAll(async () => {
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

test('Journey 1: switching chats repaints the active-chat generation picker', async ({ page }) => {
  const diagnostics = attachDiagnostics(page)
  await boot(page)
  await openCharacter(page)

  // Open chat A from the sidebar list, then confirm the picker shows preset-a.
  await clickChatRow(page, 'chat-a')
  await expect.poll(() => presetPickerSelectedId(page), { timeout: 15_000, message: diagnostics }).toBe('preset-a')

  // Go back to the list and open chat B. The picker must repaint preset-b.
  await page.locator('[data-risu-chat-action="back-to-chat-list"]').first().click()
  await clickChatRow(page, 'chat-b')

  await expect.poll(() => presetPickerSelectedId(page), { timeout: 15_000, message: diagnostics }).toBe('preset-b')

  // Classify: the rendered picker id must match the active chat's stored preset.
  const storedPresetId = await page.evaluate(() => {
    const snap = window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot()
    const character = (snap.characters as Array<Record<string, any>>)[0]
    const chat = character.chats[character.chatPage]
    return chat?.generationSettings?.promptPresetId ?? null
  })
  expect(storedPresetId, diagnostics()).toBe('preset-b')
})

test('Journey 2 (settle): a sidebar toggle flip survives the command + projection refreeze', async ({ page }) => {
  const diagnostics = attachDiagnostics(page)
  await boot(page)
  await openCharacter(page)
  await clickChatRow(page, 'chat-a')

  const flagControl = page.locator('[data-risu-generation-toggle-control][data-risu-toggle-key="flag"]')
  await expect(flagControl).toBeVisible({ timeout: 15_000 })
  await expect(flagControl).toHaveAttribute('data-risu-selected', 'true')

  // Drive a real click on the rendered toggle, then let the save + SSE
  // projection refreeze settle. CheckInput hides the real <input>; the <label>
  // is the click target.
  await flagControl.locator('label').first().click()
  await expect
    .poll(() => flagControl.getAttribute('data-risu-selected'), { timeout: 15_000, message: diagnostics })
    .toBe('false')

  // Settle window: the projection refreeze must not revert the painted flip.
  await page.waitForTimeout(750)
  await expect(flagControl).toHaveAttribute('data-risu-selected', 'false')

  const stored = await page.evaluate(() => {
    const snap = window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot()
    const character = (snap.characters as Array<Record<string, any>>)[0]
    const chat = character.chats[character.chatPage]
    return chat?.generationSettings?.sidebarToggles?.flag ?? null
  })
  expect(stored, diagnostics()).toBe('0')
})

test('Journey 3 (GATE): the sidebar tab stays on "character" after a generation-settings save', async ({ page }) => {
  const diagnostics = attachDiagnostics(page)
  await boot(page)
  await openCharacter(page)

  // Reach the chat route via a real row click so the route-application effect
  // is the one driving store state (this is what the untrack fix guards).
  await clickChatRow(page, 'chat-a')

  // Switch the sidebar to the "character" tab.
  const characterTab = page.locator('[data-risu-sidebar-tab="character"]').first()
  await expect(characterTab).toBeVisible({ timeout: 15_000 })
  await characterTab.click()
  await expect.poll(() => sidebarTabActive(page, 'character'), { timeout: 10_000, message: diagnostics }).toBe(true)
  await expect(page.locator('[data-risu-sidebar-panel="character"]').first()).toBeVisible()

  // Trigger an *unrelated* full projection refreeze (a state import/restore ->
  // state.imported -> forceServerProjectionResync, which reassigns DBState.db).
  // This is the refreeze class the untrack fix guards: a fine-grained toggle
  // save merges in place, but a resync reassigns the whole projection, which is
  // exactly what re-runs a tracked route-application effect.
  const importStatus = await importStateForResync(page)
  expect(importStatus, diagnostics()).toBe(200)

  // Store/logic side stays correct on both trees: the projection still holds the
  // selected character and its chats after the resync.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const snap = window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot()
          const character = (snap.characters as Array<Record<string, any>>)[0]
          return character?.chats?.length ?? 0
        }),
      { timeout: 15_000 },
    )
    .toBe(2)

  // DOM oracle: the rendered sidebar tab must remain on "character". On the
  // buggy tree the resync re-applies the route (botMakerMode -> false) and this
  // flips to the "chat" tab. Allow time for the spurious re-application to land.
  await page.waitForTimeout(1000)
  expect(await sidebarTabActive(page, 'character'), diagnostics()).toBe(true)
  await expect(page.locator('[data-risu-sidebar-panel="character"]').first()).toBeVisible()
})

// --- helpers ---------------------------------------------------------------

function attachDiagnostics(page: Page): () => string {
  const lines: string[] = []
  page.on('console', (m) => lines.push(`console.${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`))
  return () => lines.slice(-20).join('\n')
}

async function boot(page: Page): Promise<void> {
  // Pre-accept the Terms-of-Service gate so its z-50 modal never blocks clicks.
  // (The smoke build renders the TOS modal; agent dev mode skips it via env.)
  await page.addInitScript(() => localStorage.setItem('tos4', 'true'))
  await page.goto(harness.baseUrl)
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__RISU_FASTIFY_BROWSER_SMOKE__)), { timeout: 15_000 })
    .toBe(true)
  await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.waitForLoaded())
}

async function openCharacter(page: Page): Promise<void> {
  await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.selectCharacter(0))
  await expect(page.locator('[data-risu-chat-list="sidebar"]').first()).toBeVisible({ timeout: 15_000 })
}

async function clickChatRow(page: Page, chatId: string): Promise<void> {
  const row = page.locator(`button[data-risu-chat-idx][data-risu-chat-id="${chatId}"]`).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.click()
}

function presetPickerSelectedId(page: Page): Promise<string | null> {
  return page
    .locator('[data-risu-generation-picker-control][data-risu-picker-kind="prompt"]')
    .first()
    .getAttribute('data-risu-picker-selected-id')
}

function sidebarTabActive(page: Page, tab: 'chat' | 'character'): Promise<boolean> {
  return page
    .locator(`[data-risu-sidebar-tab="${tab}"]`)
    .first()
    .getAttribute('data-risu-sidebar-tab-active')
    .then((value) => value === 'true')
}

async function importStateForResync(page: Page): Promise<number> {
  const database = phase0FixtureDatabase()
  return page.evaluate(async (database) => {
    const headers = await window.__RISU_FASTIFY_BROWSER_SMOKE__!.activeWriterHeaders()
    const res = await fetch('/api/v1/import/risusave', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ database }),
    })
    return res.status
  }, database)
}

function phase0FixtureDatabase(): Record<string, unknown> {
  const sidebarToggleTemplate = 'flag=Flag'
  return {
    version: 1,
    didFirstSetup: true,
    formatversion: 5,
    selectedCharID: 0,
    // currentChar keeps the selected character after a full resync, so the
    // sidebar tab bar (which only shows with a character selected) stays mounted.
    currentChar: 0,
    characterOrder: [],
    characters: [
      {
        chaId: 'char-1',
        type: 'character',
        name: 'Phase0 Character',
        desc: 'DESC',
        utilityBot: false,
        chatPage: 0,
        firstMessage: 'Hello.',
        customscript: [],
        globalLore: [],
        viewScreen: 'none',
        emotionImages: [],
        chats: [
          {
            id: 'chat-a',
            name: 'Chat A',
            note: '',
            localLore: [],
            message: [],
            generationSettings: {
              configured: true,
              personaId: 'persona-a',
              modelPresetId: 'model-preset-a',
              promptPresetId: 'preset-a',
              jailbreakToggle: false,
              sidebarToggles: { flag: '1' },
            },
          },
          {
            id: 'chat-b',
            name: 'Chat B',
            note: '',
            localLore: [],
            message: [],
            generationSettings: {
              configured: true,
              personaId: 'persona-a',
              modelPresetId: 'model-preset-a',
              promptPresetId: 'preset-b',
              jailbreakToggle: false,
              sidebarToggles: { flag: '0' },
            },
          },
        ],
      },
    ],
    formatingOrder: ['main', 'description', 'chats'],
    modelPresets: [{ id: 'model-preset-a', name: 'Model Preset A' }],
    promptPresets: [
      { id: 'preset-a', name: 'Preset A', customPromptTemplateToggle: sidebarToggleTemplate },
      { id: 'preset-b', name: 'Preset B', customPromptTemplateToggle: sidebarToggleTemplate },
    ],
    loadouts: [],
    modules: [],
    username: 'User',
    selectedPersona: 0,
    personas: [{ id: 'persona-a', name: 'User', icon: '', largePortrait: false, personaPrompt: '' }],
    plugins: [],
    pluginCustomStorage: {},
    language: 'en',
    loreBookToken: 8000,
    mainPrompt: 'MAIN',
    maxContext: 100_000,
    maxResponse: 50,
    aiModel: 'echo_model',
  }
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-phase0-visible-'))
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
    throw new Error('Phase 0 visible-state harness did not bind to a TCP port')
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
