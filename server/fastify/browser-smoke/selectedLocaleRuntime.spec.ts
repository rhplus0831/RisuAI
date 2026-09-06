import { expect, test, type Page } from '@playwright/test'
import {
  closeFastBootstrapHarness,
  smallFastBootstrapFixture,
  startFastBootstrapHarness,
} from './fastBootstrapHarness.js'
import { observeFirstComposerLabel, selectedLocaleAssets } from './selectedLocaleFixture.js'

const chatPath = '/character/fast-bootstrap-small-character/fast-bootstrap-small-chat'

async function openLanguageSettings(page: Page, baseUrl: string) {
  await page.goto(`${baseUrl}${chatPath}`)
  await expect(page.getByTestId('default-chat-composer')).toHaveAttribute('aria-label', 'Message input')
  await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.waitForStartupMilestone('background-ready', 30_000))
  await page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.navigateTo('/settings/language'))
  const select = page.locator('select:has(option[value="zh-Hant"])')
  await expect(select).toHaveAttribute('aria-label', 'UI Language')
  return select
}

test('a delayed locale cannot overwrite a newer selection and is reused on the next switch', async ({ browser }) => {
  const harness = await startFastBootstrapHarness(smallFastBootstrapFixture())
  const context = await browser.newContext()
  const page = await context.newPage()
  const koreanAsset = selectedLocaleAssets().get('ko')!
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let requests = 0
  await page.route(
    (url) => url.pathname === `/${koreanAsset}`,
    async (route) => {
      requests += 1
      await held
      await route.continue()
    },
  )
  try {
    const select = await openLanguageSettings(page, harness.baseUrl)
    await select.selectOption('ko')
    await expect.poll(() => requests).toBe(1)
    await select.selectOption('en')
    await expect
      .poll(() => page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot().language))
      .toBe('en')
    const koreanResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/${koreanAsset}`)
    release()
    await koreanResponse
    await expect(select).toHaveValue('en')
    await expect(select).toHaveAttribute('aria-label', 'UI Language')
    await select.selectOption('ko')
    await expect(select).toHaveAttribute('aria-label', 'UI 언어')
    await expect
      .poll(() => page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot().language))
      .toBe('ko')
    expect(requests).toBe(1)
    await page.evaluate((route) => window.__RISU_FASTIFY_BROWSER_SMOKE__!.navigateTo(route), chatPath)
    await expect(page.getByTestId('default-chat-composer')).toHaveAttribute('aria-label', '메시지 입력')
    expect(errors).toEqual([])
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
    await context.close()
    await closeFastBootstrapHarness(harness)
  }
})

test('a failed locale chunk leaves the current UI usable and a later selection retries it', async ({ browser }) => {
  const harness = await startFastBootstrapHarness(smallFastBootstrapFixture())
  const context = await browser.newContext()
  const page = await context.newPage()
  const koreanAsset = selectedLocaleAssets().get('ko')!
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let requests = 0
  await page.route(
    (url) => url.pathname === `/${koreanAsset}`,
    async (route) => {
      if (++requests === 1) await route.fulfill({ status: 503, body: 'Temporary locale fixture failure' })
      else await route.continue()
    },
  )
  try {
    const select = await openLanguageSettings(page, harness.baseUrl)
    await select.selectOption('ko')
    const error = page.getByRole('alertdialog')
    await expect(error).toBeVisible()
    await expect(select).toHaveAttribute('aria-label', 'UI Language')
    await error.getByRole('button', { name: 'OK', exact: true }).click()
    await select.selectOption('en')
    await select.selectOption('ko')
    await expect(select).toHaveAttribute('aria-label', 'UI 언어')
    expect(requests).toBe(2)
    await page.evaluate((route) => window.__RISU_FASTIFY_BROWSER_SMOKE__!.navigateTo(route), chatPath)
    await expect(page.getByTestId('default-chat-composer')).toHaveAttribute('aria-label', '메시지 입력')
    expect(errors).toEqual([])
  } finally {
    await context.close()
    await closeFastBootstrapHarness(harness)
  }
})

test('cold selected-locale failure retries before exposing its first composer', async ({ browser }) => {
  const database = smallFastBootstrapFixture()
  database.language = 'ko'
  const harness = await startFastBootstrapHarness(database)
  const context = await browser.newContext()
  const page = await context.newPage()
  await observeFirstComposerLabel(page)
  const koreanAsset = selectedLocaleAssets().get('ko')!
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let requests = 0
  await page.route(
    (url) => url.pathname === `/${koreanAsset}`,
    async (route) => {
      if (++requests === 1) await route.fulfill({ status: 503, body: 'Temporary startup locale failure' })
      else await route.continue()
    },
  )
  try {
    await page.goto(`${harness.baseUrl}${chatPath}`)
    const error = page.getByRole('alertdialog')
    await expect(error).toBeVisible()
    await expect(page.getByTestId('default-chat-composer')).toHaveCount(0)
    await error.getByRole('button', { name: 'OK', exact: true }).click()
    await expect(page.getByTestId('default-chat-composer')).toHaveAttribute('aria-label', '메시지 입력')
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __localeStartupObservation: { firstComposerLabel: string | null } })
            .__localeStartupObservation.firstComposerLabel,
      ),
    ).toBe('메시지 입력')
    await page.evaluate(() =>
      window.__RISU_FASTIFY_BROWSER_SMOKE__!.waitForStartupMilestone('background-ready', 30_000),
    )
    expect(requests).toBe(2)
    expect(errors).toEqual([])
  } finally {
    await context.close()
    await closeFastBootstrapHarness(harness)
  }
})
