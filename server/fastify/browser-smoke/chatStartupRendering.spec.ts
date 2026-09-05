import { expect, test } from '@playwright/test'
import {
  closeFastBootstrapHarness,
  smallFastBootstrapFixture,
  startFastBootstrapHarness,
} from './fastBootstrapHarness.js'

test('direct chat startup releases the newest rows before older display work and preserves their scroll anchor', async ({
  page,
}) => {
  const database = smallFastBootstrapFixture()
  const character = (
    database.characters as Array<{ chaId: string; chats: Array<{ id: string; message: unknown[] }> }>
  )[0]
  const chat = character.chats[0]
  chat.message = Array.from({ length: 12 }, (_, index) => ({
    chatId: `startup-message-${index}`,
    role: index % 2 ? 'char' : 'user',
    data:
      index === 11
        ? 'Newest startup message'
        : `Startup history ${index}. ${'Earlier transcript paragraph. '.repeat(12)}`,
  }))
  const harness = await startFastBootstrapHarness(database)
  let releaseOlder!: () => void
  const olderGate = new Promise<void>((resolve) => {
    releaseOlder = resolve
  })
  let blockedOlder = 0
  let characterReads = 0
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === `/api/v1/characters/${character.chaId}`) characterReads++
  })
  await page.route('**/api/v1/chats/*/display-sources', async (route) => {
    const body = route.request().postDataJSON() as { targets: Array<{ index: number }> }
    if (body.targets.some((target) => target.index < 10)) {
      blockedOlder++
      await olderGate
    }
    await route.continue()
  })
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${harness.baseUrl}/character/${character.chaId}/${chat.id}`)
    const latest = page.locator('[data-risu-message-id="startup-message-11"] .chat-message-body')
    await expect(latest).toContainText('Newest startup message')
    await expect.poll(() => blockedOlder).toBe(1)
    await expect(page.locator('.risu-chat[data-risu-message-id^="startup-message-"]')).toHaveCount(12)
    await expect(page.locator('[data-risu-message-id="startup-message-0"] .chat-message-body')).not.toContainText(
      'Startup history 0',
    )
    await page.evaluate(() =>
      window.__RISU_FASTIFY_BROWSER_SMOKE__!.waitForStartupMilestone('background-ready', 10_000),
    )
    expect(characterReads).toBe(1)
    const offset = () =>
      latest.evaluate((node) => {
        const transcript = document.querySelector<HTMLElement>('[data-default-chat-transcript]')!
        const row = node.closest('.chat-message-container')!
        return Math.abs(row.getBoundingClientRect().top - transcript.getBoundingClientRect().top - transcript.clientTop)
      })
    await expect.poll(offset).toBeLessThanOrEqual(1)
    releaseOlder()
    await expect(page.locator('[data-risu-message-id="startup-message-0"] .chat-message-body')).toContainText(
      'Startup history 0',
    )
    await expect.poll(offset).toBeLessThanOrEqual(1)
    expect(errors).toEqual([])
  } finally {
    releaseOlder()
    await page.close()
    await closeFastBootstrapHarness(harness)
  }
})
