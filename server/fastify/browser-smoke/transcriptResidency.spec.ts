import { expect, test, type CDPSession, type Page, type TestInfo } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { closeFastBootstrapHarness } from './fastBootstrapHarness.js'
import {
  RESIDENCY_ADDITIONAL_ROWS,
  RESIDENCY_CHARACTER_ID,
  RESIDENCY_CHAT_ID,
  RESIDENCY_INITIAL_ROWS,
  RESIDENCY_STREAM_CHUNKS,
  startTranscriptResidencyHarness,
  transcriptResidencyFixture,
} from './transcriptResidencyFixture.js'

// Per-action trace snapshots materialize the entire measured DOM and distort
// residency timings. Functional checks still run in real Chromium.
test.use({ trace: 'off' })

// Opt into the complete cost matrix with RISU_TRANSCRIPT_COSTS=1 and run through
// the focused runner in isolation with RISU_BROWSER_SMOKE_WORKERS=1. Optional
// RISU_TRANSCRIPT_REPETITIONS repeats whole journeys (default: one).
// Each repetition starts with a fresh origin/context and no warmup. The reload
// before jumping is explicitly warm. These are measurements, not latency gates.
const TRANSCRIPT = '[data-default-chat-transcript]'
const ROWS = `${TRANSCRIPT} .risu-chat[data-risu-message-id^="residency-message-"]`
const WINDOW = `${TRANSCRIPT} [data-transcript-window-rows]`
const ORDINARY_ROW_LIMIT = 76
const LEGACY_PAGING = process.env.RISU_TRANSCRIPT_LEGACY_PAGING === '1'
const MEASURE_COSTS = process.env.RISU_TRANSCRIPT_COSTS === '1'
const DIAGNOSTICS = !MEASURE_COSTS && process.env.RISU_TRANSCRIPT_DIAGNOSTICS === '1'
// CPU profiling changes scheduling costs. These opt-in diagnostic artifacts
// never replace the unprofiled acceptance report or change its normal matrix.
const CPU_PROFILE = process.env.RISU_TRANSCRIPT_CPU_PROFILE === '1'
const PROFILE_CASE = process.env.RISU_TRANSCRIPT_PROFILE_CASE
if (PROFILE_CASE && (!CPU_PROFILE || !MEASURE_COSTS)) {
  throw new Error('RISU_TRANSCRIPT_PROFILE_CASE requires RISU_TRANSCRIPT_CPU_PROFILE=1 and RISU_TRANSCRIPT_COSTS=1')
}
if (PROFILE_CASE && !/^(desktop|mobile|mobile-cpu4x):(30|180|600)$/.test(PROFILE_CASE)) {
  throw new Error('RISU_TRANSCRIPT_PROFILE_CASE must be a profile and size, for example mobile-cpu4x:600')
}
// An isolated one-worker run remains sequential. Functional cases are
// independent, so one product failure should not suppress all other evidence.
test.describe.configure({ mode: MEASURE_COSTS ? 'serial' : 'default' })
const SIZES = MEASURE_COSTS ? [30, 180, 600] : [30]
const REPETITIONS = Number(process.env.RISU_TRANSCRIPT_REPETITIONS ?? 1)
if (!Number.isInteger(REPETITIONS) || REPETITIONS < 1 || REPETITIONS > 5) {
  throw new Error('RISU_TRANSCRIPT_REPETITIONS must be between 1 and 5')
}
const reports: unknown[] = []
const PROFILES = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, cpuRate: 1, mobile: false },
  { name: 'mobile', viewport: { width: 390, height: 844 }, cpuRate: 1, mobile: true },
  { name: 'mobile-cpu4x', viewport: { width: 390, height: 844 }, cpuRate: 4, mobile: true },
].filter((profile) => MEASURE_COSTS || profile.cpuRate === 1)
type Metrics = Record<string, number>
interface Anchor {
  id: string
  top: number
}
interface Stage {
  name: string
  startedAtMs: number
  elapsedMs: number
  mountedRows: number
  windowRows: number
  residencyMode: string | null
  transcriptElements: number
  documentElements: number
  rowHeightRange: { min: number; max: number }
  heapUsedBytes: number
  domNodes: number
  layoutMs: number
  styleMs: number
  scriptMs: number
  taskMs: number
  resources: Array<{ path: string; durationMs: number; responseEndMs: number; transferBytes: number }>
  responseEndToSettledMs: number | null
  anchorDeltaPx: number | null
}
const failedStages = new WeakMap<Error, { stage: Stage; anchor: Anchor | null }>()
const failedScrolls = new WeakMap<Error, unknown>()

for (let repetition = 0; repetition < REPETITIONS; repetition++) {
  for (const profile of PROFILES) {
    for (const messageCount of SIZES) {
      if (PROFILE_CASE && PROFILE_CASE !== `${profile.name}:${messageCount}`) continue
      test(`transcript residency ${profile.name} ${messageCount} rows repetition ${repetition}`, async ({
        browser,
      }, testInfo) => {
        // Harness deadlines scale with the explicit CPU simulation; they are
        // not latency acceptance budgets. Large jumps prepare hundreds of rows.
        test.setTimeout(180_000 * profile.cpuRate)
        const harness = await startTranscriptResidencyHarness(messageCount)
        const context = await browser.newContext({
          viewport: profile.viewport,
          isMobile: profile.mobile,
          hasTouch: profile.mobile,
        })
        await context.addInitScript((legacyPaging) => {
          performance.setResourceTimingBufferSize(2000)
          if (legacyPaging) localStorage.setItem('risu-transcript-legacy-paging', '1')
        }, LEGACY_PAGING)
        const page = await context.newPage()
        if (DIAGNOSTICS) await installScrollDiagnostics(page)
        const cdp = await context.newCDPSession(page)
        const errors: string[] = []
        const stages: Stage[] = []
        const completedScrolls: Record<string, unknown> = {}
        let olderLoads = 0
        page.on('pageerror', (error) => errors.push(error.message))
        await cdp.send('Performance.enable')
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuRate })
        try {
          const url = `${harness.baseUrl}/character/${RESIDENCY_CHARACTER_ID}/${RESIDENCY_CHAT_ID}`
          await page.goto(url)
          await waitForReady(page)
          await expect(page.locator(ROWS)).toHaveCount(Math.min(messageCount, RESIDENCY_INITIAL_ROWS))
          await waitForRenderedRows(page)
          stages.push(await snapshot(page, cdp, 'initial-cold', 0, {}))
          // Keep configuration writes outside traversal and streaming measurements.
          await configureGeneration(page)
          await waitForRenderedRows(page)

          let loaded = await windowRows(page)
          while (loaded < messageCount) {
            const previousLoaded = loaded
            let anchor: Anchor | null = null
            stages.push(
              await measure(
                page,
                cdp,
                `older-page-${++olderLoads}`,
                async () => {
                  anchor = await scrollToOlderEdge(page)
                  await expect.poll(() => windowRows(page)).toBeGreaterThan(previousLoaded)
                  await waitForRenderedRows(page)
                },
                () => anchor,
              ),
            )
            loaded = await windowRows(page)
            expect(loaded).toBe(Math.min(messageCount, previousLoaded + RESIDENCY_ADDITIONAL_ROWS))
          }
          expect(loaded).toBe(messageCount)
          const accumulatedScroll = await sampleScrolling(page, cdp, 'accumulated')
          completedScrolls.accumulatedScroll = accumulatedScroll
          const retainedAccumulated = await retainedHeap(cdp)
          completedScrolls.retainedAccumulated = retainedAccumulated

          // Navigation reload resets the ordinary mount window; storage/HTTP caches
          // are now warm. Opening bookmarks can fully hydrate data independently of
          // DOM residency. Both costs remain separate from the actual jump. The
          // chat-list route unmounts the ordinary transcript before the bookmark.
          await page.reload()
          await waitForReady(page)
          await expect(page.locator(ROWS)).toHaveCount(Math.min(messageCount, RESIDENCY_INITIAL_ROWS))
          await waitForRenderedRows(page)
          stages.push(await snapshot(page, cdp, 'reload-warm', 0, {}))
          stages.push(
            await measure(page, cdp, 'bookmark-data-preparation', async () => {
              const expand = page.locator('[data-risu-sidebar-toggle="expand"]')
              if (await expand.isVisible()) await expand.click()
              await page.locator('[data-risu-chat-action="back-to-chat-list"]').click()
              await page.locator('[data-risu-chat-action="bookmarks"]').click()
              await expect(page.locator('[data-risu-bookmark-id="residency-message-5"]')).toBeVisible()
            }),
          )
          stages.push(
            await measure(page, cdp, 'deep-jump', async () => {
              await page
                .locator('[data-risu-bookmark-id="residency-message-5"]')
                .getByRole('button', { name: 'Go to Chat' })
                .click()
              const sidebarDialog = page.locator('[data-risu-responsive-shell="shared-sidebar-dialog"]')
              if (await sidebarDialog.isVisible()) await page.keyboard.press('Escape')
              const target = page.locator(`${ROWS}[data-chat-index="5"]`)
              await expect(target).toHaveClass(/ring-blue-500/)
              try {
                await expect(target).toBeInViewport()
              } catch (error) {
                await recordJumpFailure(page, testInfo)
                throw error
              }
              await waitForRenderedRows(page, 30_000 * profile.cpuRate)
            }),
          )
          await expect.poll(() => windowRows(page)).toBe(messageCount)

          // Change an already decoded local image's height to isolate late media
          // geometry from hydration and network work. Record the actual anchor drift.
          const imageAnchor = await currentAnchor(page)
          stages.push(
            await measure(
              page,
              cdp,
              'late-media-resize',
              async () => {
                const image = page.locator(`${ROWS}[data-chat-index="6"] img[alt="Residency image 6"]`)
                await expect(image).toHaveCount(1)
                await image.evaluate((node: HTMLImageElement) => {
                  node.style.height = `${node.getBoundingClientRect().height + 96}px`
                })
                await settleFrames(page)
              },
              () => imageAnchor,
            ),
          )

          await page.getByTestId('default-chat-composer').fill('Residency probe send.')
          stages.push(
            await measure(page, cdp, 'send-admission-provider-held', async () => {
              await page.getByTestId('default-chat-send-button').click()
              await expect(
                page.locator('.chat-message-container[data-generation-display-projection="send"]'),
              ).toHaveCount(1)
            }),
          )
          for (const [index] of RESIDENCY_STREAM_CHUNKS.entries()) {
            stages.push(
              await measure(page, cdp, `stream-chunk-${index + 1}`, async () => {
                harness.releaseChunk(index)
                const expected = ['Residency streamed response.', 'Growing response', 'Completed response'][index]
                await expect(
                  page.locator(`${TRANSCRIPT} .chat-message-body`).filter({ hasText: expected }),
                ).toHaveCount(1)
                await settleFrames(page)
              }),
            )
          }
          stages.push(
            await measure(page, cdp, 'stream-finalization', async () => {
              await expect(page.getByTestId('default-chat-send-button')).toBeVisible()
              await expect(
                page.locator('.chat-message-container[data-generation-display-projection="send"]'),
              ).toHaveCount(0)
            }),
          )
          const finalScroll = await sampleScrolling(page, cdp, 'final')
          completedScrolls.finalScroll = finalScroll
          const retainedAfterStream = await retainedHeap(cdp)
          completedScrolls.retainedAfterStream = retainedAfterStream
          expect(errors).toEqual([])
          await attachReport(testInfo, {
            source: sourceAnchor(),
            runtime: {
              node: process.version,
              browser: browser.version(),
              platform: `${os.platform()} ${os.arch()}`,
              cpu: os.cpus()[0]?.model,
              cpuCount: os.cpus().length,
              memoryBytes: os.totalmem(),
            },
            profile: {
              ...profile,
              simulation:
                profile.cpuRate > 1 ? 'Chromium 4x CPU slowdown; not a physical low-memory/mobile device' : null,
            },
            repetition,
            repetitionsRequested: REPETITIONS,
            fullCostMatrix: MEASURE_COSTS,
            warmupRuns: 0,
            traceRecording: false,
            residency: {
              mode: LEGACY_PAGING ? 'legacy' : 'bounded',
              ordinaryMountedRowLimit: LEGACY_PAGING ? null : ORDINARY_ROW_LIMIT,
              rollbackFlag: 'localStorage.risu-transcript-legacy-paging=1',
              windowRows: 'Logical paged display window; independent of hydrated data and mounted DOM rows.',
            },
            cache:
              'Fresh origin/context through accumulated traversal; warm reload before bookmark/jump/stream stages.',
            fixture: {
              messageCount,
              initialRows: RESIDENCY_INITIAL_ROWS,
              additionalRows: RESIDENCY_ADDITIONAL_ROWS,
              olderLoads,
              images: Math.ceil(messageCount / 6),
              imageLoading: 'Eager local PNG decoding stress fixture; ordinary parser-default images are lazy.',
              serializedBytes: Buffer.byteLength(JSON.stringify(transcriptResidencyFixture(messageCount))),
              streamChunks: RESIDENCY_STREAM_CHUNKS.length,
            },
            attribution:
              'Resource durations measure hydration/display-source request delivery. responseEndToSettledMs includes scheduling, parser, mounting and image decoding; it is NOT isolated parser CPU. CDP scriptMs also includes other JavaScript. CDP layout/style are reported independently. Browser polling, CDP sampling, and three settling animation frames are included in stage wall times. Each unchanged 48-frame scroll sweep has a separately measured settlement stage before retained-heap collection, including admission completion, rendered text/images, and visible message coverage. Provider release is manually gated; first-chunk time can include remaining generation preparation after projected-row admission. Actual mounted and logical window counts expose any window reset on send. The cost journey has no continuous DOM observer; separate functional cases check transient row bounds.',
            workflows: {
              interactive: ['ordinary older-page traversal', 'bookmark jump', 'streaming', 'late image resize'],
              fullDataOnly:
                'Bookmark preparation may hydrate the full transcript while its chat-list route has no transcript DOM; export/tokenization similarly need data, not necessarily DOM.',
              screenshot:
                'Explicit temporary full materialization, outside the interactive residency envelope; measured by the separate screenshot case and restored to the prior window.',
            },
            stages,
            accumulatedScroll,
            finalScroll,
            retainedAccumulated,
            retainedAfterStream,
          })
        } catch (error) {
          await recordJourneyFailure(page, testInfo, error, {
            source: sourceAnchor(),
            runtime: { node: process.version, browser: browser.version(), platform: `${os.platform()} ${os.arch()}` },
            profile,
            repetition,
            fullCostMatrix: MEASURE_COSTS,
            diagnosticCpuProfiling: CPU_PROFILE,
            residencyMode: LEGACY_PAGING ? 'legacy' : 'bounded',
            fixture: {
              messageCount,
              initialRows: RESIDENCY_INITIAL_ROWS,
              additionalRows: RESIDENCY_ADDITIONAL_ROWS,
              olderLoads,
              images: Math.ceil(messageCount / 6),
              serializedBytes: Buffer.byteLength(JSON.stringify(transcriptResidencyFixture(messageCount))),
              streamChunks: RESIDENCY_STREAM_CHUNKS.length,
            },
            stages,
            ...completedScrolls,
            pageErrors: errors,
          }).catch((reportError) => console.error('Failed to retain transcript failure report:', reportError))
          throw error
        } finally {
          harness.releaseAll()
          await context.close()
          await closeFastBootstrapHarness(harness)
        }
      })
    }
  }
}

test('transcript residency screenshot is temporary full materialization', async ({ page, browser }, testInfo) => {
  test.skip(Boolean(PROFILE_CASE))
  test.setTimeout(180_000)
  const messageCount = 36
  const harness = await startTranscriptResidencyHarness(messageCount)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${harness.baseUrl}/character/${RESIDENCY_CHARACTER_ID}/${RESIDENCY_CHAT_ID}`)
    await waitForReady(page)
    await expect(page.locator(ROWS)).toHaveCount(RESIDENCY_INITIAL_ROWS)
    await waitForRenderedRows(page)
    await page.evaluate((selector) => {
      const state = { peakMountedRows: 0, observer: null as MutationObserver | null }
      state.observer = new MutationObserver(() => {
        state.peakMountedRows = Math.max(state.peakMountedRows, document.querySelectorAll(selector).length)
      })
      state.observer.observe(document.querySelector('[data-default-chat-transcript]')!, {
        childList: true,
        subtree: true,
      })
      Reflect.set(window, '__residencyCapture', state)
    }, ROWS)
    let pngBytes = 0
    const stage = await measure(page, cdp, 'explicit-full-screenshot', async () => {
      await page.getByTestId('default-chat-menu-button').click()
      const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
      await page.getByTestId('default-chat-screenshot-button').click()
      const download = await downloadPromise
      expect(await download.failure()).toBeNull()
      const png = readFileSync((await download.path())!)
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      pngBytes = png.length
      await expect(page.locator(ROWS)).toHaveCount(RESIDENCY_INITIAL_ROWS)
    })
    const peakMountedRows = await page.evaluate(() => {
      const state = Reflect.get(window, '__residencyCapture') as { peakMountedRows: number; observer: MutationObserver }
      state.observer.disconnect()
      Reflect.deleteProperty(window, '__residencyCapture')
      return state.peakMountedRows
    })
    expect(peakMountedRows).toBe(messageCount)
    await attachReport(testInfo, {
      source: sourceAnchor(),
      browser: browser.version(),
      messageCount,
      repetition: testInfo.repeatEachIndex,
      workflow:
        'Explicit full capture, outside ordinary interactive residency. Includes image/canvas encoding and download. MutationObserver records peak transcript rows; canvas memory is not captured by post-operation JS heap.',
      peakMountedRows,
      restoredMountedRows: stage.mountedRows,
      pngBytes,
      stage,
    })
  } finally {
    harness.releaseAll()
    await page.close()
    await closeFastBootstrapHarness(harness)
  }
})

// Functional interaction journeys have continuous DOM observation. Keep them
// outside the cost matrix so their fixtures, clipboard hooks, and observer work
// cannot change the before/after timing journey.
for (const mobile of [false, true]) {
  test(`transcript residency preserves editing, selection and copy ${mobile ? 'mobile' : 'desktop'}`, async ({
    browser,
  }, testInfo) => {
    test.skip(MEASURE_COSTS || LEGACY_PAGING)
    test.setTimeout(180_000)
    const harness = await startTranscriptResidencyHarness(180)
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      isMobile: mobile,
      hasTouch: mobile,
    })
    const page = await context.newPage()
    if (DIAGNOSTICS) await installScrollDiagnostics(page)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await page.goto(`${harness.baseUrl}/character/${RESIDENCY_CHARACTER_ID}/${RESIDENCY_CHAT_ID}`)
      await waitForReady(page)
      await waitForRenderedRows(page)
      await page.evaluate(async () => {
        await window.__RISU_FASTIFY_BROWSER_SMOKE__!.patchRuntimeSettings({
          disableAutoPopupMessageEditor: true,
          useChatCopy: true,
        })
        Reflect.set(window, '__residencyCopiedText', '')
        Object.defineProperty(navigator.clipboard, 'write', {
          configurable: true,
          value: async (items: ClipboardItem[]) => {
            const text = await (await items[0].getType('text/plain')).text()
            Reflect.set(window, '__residencyCopiedText', text)
          },
        })
        Object.defineProperty(navigator.clipboard, 'writeText', {
          configurable: true,
          value: async (text: string) => Reflect.set(window, '__residencyCopiedText', text),
        })
      })
      await observeOrdinaryRowBound(page)
      await bookmarkJump(page, testInfo)
      await expect.poll(() => windowRows(page)).toBe(180)
      await waitForRenderedRows(page)
      const target = page.locator(`${ROWS}[data-chat-index="5"]`)
      await clickMessageAction(page, 5, 'edit')
      const editor = target.getByRole('textbox')
      await expect(editor).toBeVisible()
      const original = await editor.inputValue()
      const draft = `${original}\n\nPreserved resident editor draft.`
      await editor.fill(draft)
      await scrollToLatestEdge(page)
      await expect(page.locator(`${ROWS}[data-chat-index="179"]`)).toBeInViewport()
      await expect(editor).toHaveValue(draft)
      await expect(editor).toBeFocused()
      await clickMessageAction(page, 5, 'edit')
      await expect(target.getByRole('textbox')).toHaveCount(0)
      await expect(target.locator('.chat-message-body')).toContainText('Preserved resident editor draft.')

      // Select text in one mounted message, then move the viewport away without
      // changing selection. Its row must remain available until selection ends.
      const selected = await target.locator('.chat-message-body').evaluate((body) => {
        const text = document.createTreeWalker(body, NodeFilter.SHOW_TEXT).nextNode()!
        const range = document.createRange()
        range.setStart(text, 0)
        range.setEnd(text, Math.min(15, text.textContent!.length))
        const selection = window.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
        return selection.toString()
      })
      expect(selected).toContain('Residency row')
      await scrollToLatestEdge(page)
      await expect(target).toHaveCount(1)
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected)
      await page.evaluate(() => {
        window.getSelection()?.removeAllRanges()
        document.dispatchEvent(new Event('selectionchange'))
      })
      await bookmarkJump(page, testInfo)
      await clickMessageAction(page, 5, 'copy')
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, '__residencyCopiedText')))
        .toContain('Preserved resident editor draft.')
      // Closing the copy alert restores ordinary keyboard navigation; the
      // composer remains a reachable named textbox after an evicted-row jump.
      const ok = page.getByRole('button', { name: 'OK', exact: true })
      if (await ok.isVisible()) await ok.click()
      await page.getByTestId('default-chat-composer').focus()
      await expect(page.getByTestId('default-chat-composer')).toBeFocused()
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true)

      // The real branch-source link opens a folded history. Expanding it must
      // retain the same logical history while returning to ordinary residency.
      await bookmarkJump(page, testInfo)
      await clickMessageAction(page, 5, 'branch')
      await page.getByRole('button', { name: 'YES', exact: true }).click()
      const branchSource = page.getByRole('button', {
        name: 'This chat has been branched from Transcript Residency Chat.',
        exact: true,
      })
      await expect(branchSource).toBeVisible()
      await branchSource.click()
      const loadMore = page.getByRole('button', { name: 'Load More', exact: true })
      await expect(loadMore).toBeVisible()
      await loadMore.scrollIntoViewIfNeeded()
      await loadMore.focus()
      await settleFrames(page)
      const foldedAnchor = await readFoldGeometry(page)
      await loadMore.evaluate((button) => {
        button.addEventListener(
          'click',
          () => {
            const transcript = document.querySelector('[data-default-chat-transcript]')!
            const row = transcript.querySelector('[data-chat-index="5"]')!
            Reflect.set(window, '__residencyFoldClick', {
              top: row.getBoundingClientRect().top - transcript.getBoundingClientRect().top,
              scrollTop: transcript.scrollTop,
            })
          },
          { capture: true, once: true },
        )
      })
      expect(
        await page
          .locator(ROWS)
          .evaluateAll((rows) => rows.every((row) => Number((row as HTMLElement).dataset.chatIndex) <= 5)),
      ).toBe(true)
      await loadMore.click()
      await expect.poll(() => windowRows(page)).toBe(180)
      await expect(page.locator(WINDOW)).toHaveAttribute('data-transcript-residency-mode', 'bounded')
      await expect(target).toHaveCount(1)
      await waitForRenderedRows(page)
      const unfoldedAnchor = await readFoldGeometry(page)
      if (Math.abs(unfoldedAnchor.top - foldedAnchor.top) > 1) {
        console.error(
          'Transcript fold anchor failure:',
          JSON.stringify({
            before: foldedAnchor,
            click: await page.evaluate(() => Reflect.get(window, '__residencyFoldClick')),
            after: unfoldedAnchor,
          }),
        )
      }
      expect(
        Math.abs(unfoldedAnchor.top - foldedAnchor.top),
        'Unfolding preserves the folded message offset',
      ).toBeLessThanOrEqual(1)
      await assertObservedOrdinaryRowBound(page)
      expect(errors).toEqual([])
    } finally {
      harness.releaseAll()
      await context.close()
      await closeFastBootstrapHarness(harness)
    }
  })
}

for (const outcome of ['failure', 'cancellation'] as const) {
  test(`transcript residency restores ordinary rows after screenshot ${outcome}`, async ({ page }) => {
    test.skip(MEASURE_COSTS || LEGACY_PAGING)
    test.setTimeout(180_000)
    const harness = await startTranscriptResidencyHarness(90)
    const downloads: string[] = []
    page.on('download', (download) => downloads.push(download.suggestedFilename()))
    try {
      const url = `${harness.baseUrl}/character/${RESIDENCY_CHARACTER_ID}/${RESIDENCY_CHAT_ID}`
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto(url)
      await waitForReady(page)
      await waitForRenderedRows(page)
      await observeOrdinaryRowBound(page)
      if (outcome === 'failure') {
        await page.evaluate(() => {
          HTMLCanvasElement.prototype.toDataURL = () => {
            throw new Error('Intentional residency screenshot encoding failure')
          }
        })
      }
      await page.getByTestId('default-chat-menu-button').click()
      await page.getByTestId('default-chat-screenshot-button').click()
      await expect(page.locator(WINDOW)).toHaveAttribute('data-transcript-residency-mode', 'capture')
      if (outcome === 'failure') {
        await expect(page.getByText('Error while taking screenshot', { exact: true })).toBeVisible({ timeout: 120_000 })
      } else {
        // Route identity loss cancels the existing screenshot operation. Return
        // through client navigation to verify its finally block cannot leave the
        // next transcript in full materialization mode.
        await page.evaluate((characterId) => {
          window.__RISU_FASTIFY_BROWSER_SMOKE__!.navigateTo(`/character/${characterId}`)
        }, RESIDENCY_CHARACTER_ID)
        await expect(page.locator(TRANSCRIPT)).toHaveCount(0)
        await page.evaluate(
          ({ characterId, chatId }) => {
            window.__RISU_FASTIFY_BROWSER_SMOKE__!.navigateTo(`/character/${characterId}/${chatId}`)
          },
          { characterId: RESIDENCY_CHARACTER_ID, chatId: RESIDENCY_CHAT_ID },
        )
        await waitForReady(page)
      }
      await expect(page.locator(WINDOW)).toHaveAttribute('data-transcript-residency-mode', 'bounded')
      await expect.poll(() => windowRows(page)).toBe(RESIDENCY_INITIAL_ROWS)
      await expect(page.locator(ROWS)).toHaveCount(RESIDENCY_INITIAL_ROWS)
      await settleFrames(page)
      await assertObservedOrdinaryRowBound(page, true)
      expect(downloads).toEqual([])
    } finally {
      harness.releaseAll()
      await page.close()
      await closeFastBootstrapHarness(harness)
    }
  })
}

test('transcript residency bounds eight editors through page reset and keyboard gap navigation', async ({
  page,
}, testInfo) => {
  test.skip(MEASURE_COSTS || LEGACY_PAGING)
  test.setTimeout(180_000)
  const harness = await startTranscriptResidencyHarness(180)
  const errors: string[] = []
  const acceptedMessageEdits: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname
    if (
      response.status() === 200 &&
      response.request().method() === 'PATCH' &&
      pathname.startsWith('/api/v1/commands/messages/residency-message-')
    ) {
      acceptedMessageEdits.push(decodeURIComponent(pathname.split('/').at(-1)!))
    }
  })
  if (DIAGNOSTICS) await installScrollDiagnostics(page)
  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${harness.baseUrl}/character/${RESIDENCY_CHARACTER_ID}/${RESIDENCY_CHAT_ID}`)
    await waitForReady(page)
    await waitForRenderedRows(page)
    await page.evaluate(async () => {
      await window.__RISU_FASTIFY_BROWSER_SMOKE__!.patchRuntimeSettings({ disableAutoPopupMessageEditor: true })
      const events: unknown[] = []
      Reflect.set(window, '__residencyEditorEvents', events)
      for (const type of ['pointerdown', 'pointerup', 'click']) {
        document.addEventListener(
          type,
          (event) => {
            if (!(event.target instanceof Element) || !event.target.closest('[data-default-chat-transcript]')) return
            if (events.length >= 64) events.shift()
            const action = event.target.closest('[data-risu-message-action]')
            const row = event.target.closest('.risu-chat')
            events.push({
              type,
              time: performance.now(),
              phase: Reflect.get(window, '__residencyEditorPhase'),
              row: row?.getAttribute('data-chat-index'),
              action: action?.getAttribute('data-risu-message-action'),
              label: action?.getAttribute('aria-label'),
              disabled: action?.hasAttribute('disabled'),
              path: event
                .composedPath()
                .slice(0, 4)
                .map((node) => (node instanceof Element ? node.outerHTML.slice(0, 180) : String(node))),
            })
          },
          true,
        )
      }
    })
    await observeOrdinaryRowBound(page)
    await bookmarkJump(page, testInfo)
    await waitForRenderedRows(page)

    // A screen reader can discover the omitted region by its named button;
    // keyboard activation mounts its boundary message and transfers focus.
    const gap = page.getByRole('button', { name: /^Show messages \d+–\d+$/ }).first()
    await expect(gap).toHaveAccessibleName(/^Show messages \d+–\d+$/)
    const gapLabel = (await gap.innerText()).trim()
    await gap.focus()
    await settleFrames(page)
    await expect(gap).toBeFocused()
    // Focusing an offscreen control scrolls it into view. Its announced range
    // must remain stable until activation or blur.
    await expect(gap).toHaveAccessibleName(gapLabel)
    const gapRange = gapLabel.match(/^Show messages (\d+)–(\d+)$/)!
    const boundaryIndex = Number(gapRange[1]) - 1
    const boundary = page.locator(`${ROWS}[data-chat-index="${boundaryIndex}"]`)
    await expect(boundary).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(boundary).toBeInViewport()
    await expect(page.locator(`[data-transcript-row-id="residency-message-${boundaryIndex}"]`)).toBeFocused()

    await bookmarkJump(page, testInfo)
    await waitForRenderedRows(page)
    const drafts = new Map<number, string>()
    for (let index = 5; index < 13; index++) {
      await clickMessageAction(page, index, 'edit')
      const editor = page.locator(`${ROWS}[data-chat-index="${index}"]`).getByRole('textbox')
      const draft = `${await editor.inputValue()}\n\nRetained editor ${index}.`
      drafts.set(index, draft)
      await editor.fill(draft)
    }
    await expect(page.locator(`${ROWS} textarea`)).toHaveCount(8)
    await clickMessageAction(page, 13, 'edit')
    await expect(
      page.getByRole('dialog', {
        name: 'Finish an edit or wait for a message action to complete before starting another. Up to eight messages can have active actions at once.',
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.locator(`${ROWS}[data-chat-index="13"]`).getByRole('textbox')).toHaveCount(0)
    await page.getByRole('button', { name: 'OK', exact: true }).click()

    await scrollToLatestEdge(page)
    for (const [index, draft] of drafts) {
      await expect(page.locator(`${ROWS}[data-chat-index="${index}"]`).getByRole('textbox')).toHaveValue(draft)
    }
    // The configured ordinary page count shrinks immediately. Its already
    // hydrated logical range can remain extended while the eight editors own
    // older rows; their DOM stays within the same finite residency envelope.
    await page.evaluate(async () => {
      await window.__RISU_FASTIFY_BROWSER_SMOKE__!.patchRuntimeSettings({ chatLoadInitialPages: 15 })
    })
    await expect
      .poll(() =>
        page.evaluate(() =>
          Reflect.get(window.__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot(), 'chatLoadInitialPages'),
        ),
      )
      .toBe(15)
    await settleFrames(page)
    await scrollToLatestEdge(page)
    for (const [index, draft] of drafts) {
      await expect(page.locator(`${ROWS}[data-chat-index="${index}"]`).getByRole('textbox')).toHaveValue(draft)
    }
    await expect(page.locator(`${ROWS} textarea`)).toHaveCount(8)
    for (const [index, draft] of drafts) {
      const row = page.locator(`${ROWS}[data-chat-index="${index}"]`)
      await expect(row.getByRole('textbox'), `Editor ${index} retains its draft while siblings save`).toHaveValue(draft)
      await expect(row.locator('[data-risu-message-action="edit"]')).toHaveAttribute('aria-label', 'Save')
      await page.evaluate((index) => Reflect.set(window, '__residencyEditorPhase', `save-${index}`), index)
      await clickMessageAction(page, index, 'edit')
      await expect(page.locator(`${ROWS}[data-chat-index="${index}"]`).getByRole('textbox')).toHaveCount(0)
    }
    await expect.poll(() => acceptedMessageEdits.length).toBe(8)
    expect(acceptedMessageEdits.sort()).toEqual([...drafts.keys()].map((index) => `residency-message-${index}`).sort())
    const saved = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/chats/${RESIDENCY_CHAT_ID}/messages?start=5&limit=8`,
      headers: { 'risu-auth': harness.assertion },
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().message).toEqual(
      [...drafts].map(([index, data]) => expect.objectContaining({ chatId: `residency-message-${index}`, data })),
    )
    await page.getByTestId('default-chat-composer').focus()
    await page.evaluate(() => {
      window.getSelection()?.removeAllRanges()
      document.dispatchEvent(new Event('selectionchange'))
    })
    await scrollToLatestEdge(page)
    // Clicking older editors can legitimately trigger the existing older-page
    // loader. A fresh settings change proves every reservation was released.
    await page.evaluate(async () => {
      await window.__RISU_FASTIFY_BROWSER_SMOKE__!.patchRuntimeSettings({ chatLoadInitialPages: 14 })
    })
    await expect.poll(() => windowRows(page)).toBe(14)
    await expect(page.locator(ROWS)).toHaveCount(14)
    await assertObservedOrdinaryRowBound(page)
    expect(errors).toEqual([])
  } catch (error) {
    const state = await page.evaluate(() => ({
      rows: Array.from(document.querySelectorAll<HTMLElement>('[data-default-chat-transcript] .risu-chat')).map(
        (row) => ({
          id: row.dataset.risuMessageId,
          index: row.dataset.chatIndex,
          editAction: row.querySelector('[data-risu-message-action="edit"]')?.getAttribute('aria-label'),
          disabled: row.querySelector('[data-risu-message-action="edit"]')?.hasAttribute('disabled'),
          draft: row.querySelector('textarea')?.value,
        }),
      ),
      focused: document.activeElement?.outerHTML.slice(0, 500),
      events: Reflect.get(window, '__residencyEditorEvents'),
    }))
    await testInfo.attach('editor-residency-failure', {
      body: Buffer.from(JSON.stringify(state, null, 2)),
      contentType: 'application/json',
    })
    console.error('Transcript editor failure state:', JSON.stringify(state))
    throw error
  } finally {
    harness.releaseAll()
    await page.close()
    await closeFastBootstrapHarness(harness)
  }
})

test('transcript residency cancels a pending jump when its route is hidden and reopened', async ({ page }) => {
  test.skip(MEASURE_COSTS || LEGACY_PAGING)
  test.setTimeout(180_000)
  const harness = await startTranscriptResidencyHarness(180)
  let releaseImage!: () => void
  const imageGate = new Promise<void>((resolve) => {
    releaseImage = resolve
  })
  let imageRequested = false
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${harness.baseUrl}/character/${RESIDENCY_CHARACTER_ID}/${RESIDENCY_CHAT_ID}`)
    await waitForReady(page)
    await waitForRenderedRows(page)
    const fixtureRows = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/chats/${RESIDENCY_CHAT_ID}/messages?start=5&limit=2`,
      headers: { 'risu-auth': harness.assertion },
    })
    expect(fixtureRows.statusCode).toBe(200)
    const [target, imageRow] = fixtureRows.json().message as Array<{ data: string }>
    const png = Buffer.from(imageRow.data.match(/src="data:image\/png;base64,([^"]+)"/)![1], 'base64')
    // Only this functional fixture gains a same-origin delayed image. The cost
    // matrix continues to use the original unmodified eager local PNG rows.
    await page.route('**/transcript-pending-jump.png', async (route) => {
      imageRequested = true
      await imageGate
      await route.fulfill({ contentType: 'image/png', body: png }).catch(() => undefined)
    })
    const mutation = await page.evaluate(
      async ({ messageId, data }) => {
        const headers = await window.__RISU_FASTIFY_BROWSER_SMOKE__!.activeWriterHeaders()
        let baseRevision = (await (await fetch('/api/v1/bootstrap', { headers })).json()).revision
        for (let attempt = 0; attempt < 5; attempt++) {
          const response = await fetch(`/api/v1/commands/messages/${messageId}`, {
            method: 'PATCH',
            headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify({ baseRevision, patch: { data } }),
          })
          const body = await response.json()
          if (response.status !== 409 || body.error !== 'revision_conflict') return response.status
          baseRevision = body.currentRevision
        }
        return 409
      },
      {
        messageId: 'residency-message-5',
        data: `${target.data}\n\n<img alt="Pending jump gate" src="/transcript-pending-jump.png" loading="eager" width="240" height="96">`,
      },
    )
    expect(mutation).toBe(200)
    await observeOrdinaryRowBound(page)
    const expand = page.locator('[data-risu-sidebar-toggle="expand"]')
    if (await expand.isVisible()) await expand.click()
    await page.locator('[data-risu-chat-action="back-to-chat-list"]').click()
    await page.locator('[data-risu-chat-action="bookmarks"]').click()
    const bookmark = page.locator('[data-risu-bookmark-id="residency-message-5"]')
    await expect(bookmark).toBeVisible()
    await bookmark.locator('button[aria-expanded]').click()
    await expect.poll(() => imageRequested).toBe(true)
    await bookmark.getByRole('button', { name: 'Go to Chat' }).click()
    const pendingTarget = page.locator(`${ROWS}[data-chat-index="5"]`)
    await expect(pendingTarget).toHaveCount(1)
    await expect(pendingTarget.locator('img[alt="Pending jump gate"]')).toHaveCount(1)
    await expect(pendingTarget).not.toHaveClass(/ring-blue-500/)
    // Let the existing jump enter its image wait after mounting the target.
    await expect
      .poll(() =>
        pendingTarget.evaluate((row) => {
          const image = row.querySelector<HTMLImageElement>('img[alt="Pending jump gate"]')!
          return !image.complete
        }),
      )
      .toBe(true)
    await settleFrames(page)
    await page.evaluate((characterId) => {
      window.__RISU_FASTIFY_BROWSER_SMOKE__!.navigateTo(`/character/${characterId}`)
    }, RESIDENCY_CHARACTER_ID)
    await expect(page.locator(TRANSCRIPT)).toHaveCount(0)
    await page.evaluate(
      ({ characterId, chatId }) => {
        window.__RISU_FASTIFY_BROWSER_SMOKE__!.navigateTo(`/character/${characterId}/${chatId}`)
      },
      { characterId: RESIDENCY_CHARACTER_ID, chatId: RESIDENCY_CHAT_ID },
    )
    await waitForReady(page)
    // Reopening the same chat can retain its logical page window; the new
    // mounted viewport must start at the latest row and stay independently bounded.
    await expect(page.locator(WINDOW)).toHaveAttribute('data-transcript-residency-mode', 'bounded')
    const latest = page.locator(`${ROWS}[data-chat-index="179"]`)
    await expect(latest).toBeInViewport()
    await expect(pendingTarget).toHaveCount(0)
    // The production jump's image wait has a four-second deadline. Keep the
    // image held through that deadline, then verify its delayed completion too.
    await page.waitForTimeout(4_200)
    await expect(latest).toBeInViewport()
    await expect(pendingTarget).toHaveCount(0)
    releaseImage()
    await settleFrames(page)
    await expect(latest).toBeInViewport()
    await expect(page.locator(WINDOW)).toHaveAttribute('data-transcript-residency-mode', 'bounded')
    await assertObservedOrdinaryRowBound(page)
    expect(errors).toEqual([])
  } finally {
    releaseImage()
    harness.releaseAll()
    await page.close()
    await closeFastBootstrapHarness(harness)
  }
})

test('transcript legacy paging rollback traverses 180 mounted rows without spacers', async ({ page }, testInfo) => {
  test.skip(MEASURE_COSTS)
  test.setTimeout(180_000)
  const harness = await startTranscriptResidencyHarness(180)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('risu-transcript-legacy-paging', '1'))
  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${harness.baseUrl}/character/${RESIDENCY_CHARACTER_ID}/${RESIDENCY_CHAT_ID}`)
    await waitForReady(page)
    await expect(page.locator(WINDOW)).toHaveAttribute('data-transcript-residency-mode', 'legacy')
    await expect(page.locator(ROWS)).toHaveCount(RESIDENCY_INITIAL_ROWS)
    await waitForRenderedRows(page)
    for (let loaded = RESIDENCY_INITIAL_ROWS; loaded < 180; loaded += RESIDENCY_ADDITIONAL_ROWS) {
      const anchor = await scrollToOlderEdge(page)
      await expect(page.locator(ROWS)).toHaveCount(loaded + RESIDENCY_ADDITIONAL_ROWS)
      await waitForRenderedRows(page)
      expect(await windowRows(page)).toBe(loaded + RESIDENCY_ADDITIONAL_ROWS)
      if (anchor) {
        const top = await page
          .locator(`${ROWS}[data-risu-message-id="${anchor.id}"]`)
          .evaluate(
            (row) =>
              row.getBoundingClientRect().top -
              row.closest('[data-default-chat-transcript]')!.getBoundingClientRect().top,
          )
        expect(Math.abs(top - anchor.top), 'Legacy older-page anchor').toBeLessThanOrEqual(1)
      }
    }
    await expect(page.locator(ROWS)).toHaveCount(180)
    expect(await page.locator(ROWS).count()).toBeGreaterThan(ORDINARY_ROW_LIMIT)
    await expect(page.locator(`${TRANSCRIPT} [data-transcript-spacer]`)).toHaveCount(0)
    await bookmarkJump(page, testInfo)
    await waitForRenderedRows(page)
    await expect(page.locator(ROWS)).toHaveCount(180)
    await scrollToLatestEdge(page)
    await expect(page.locator(`${ROWS}[data-chat-index="179"]`)).toBeInViewport()
    await expect(page.locator(`${TRANSCRIPT} [data-transcript-spacer]`)).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    harness.releaseAll()
    await page.close()
    await closeFastBootstrapHarness(harness)
  }
})

test('transcript residency promotes readable visible messages during rapid movement and settles', async ({
  browser,
}, testInfo) => {
  test.skip(MEASURE_COSTS || LEGACY_PAGING)
  test.setTimeout(180_000)
  const harness = await startTranscriptResidencyHarness(180)
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto(`${harness.baseUrl}/character/${RESIDENCY_CHARACTER_ID}/${RESIDENCY_CHAT_ID}`)
    await waitForReady(page)
    await waitForRenderedRows(page)
    for (let loaded = RESIDENCY_INITIAL_ROWS; loaded < 180; loaded += RESIDENCY_ADDITIONAL_ROWS) {
      await scrollToOlderEdge(page)
      await expect.poll(() => windowRows(page)).toBe(loaded + RESIDENCY_ADDITIONAL_ROWS)
      await waitForRenderedRows(page)
    }
    await page.locator(TRANSCRIPT).evaluate((transcript) => {
      transcript.scrollTop = -(transcript.scrollHeight - transcript.clientHeight) * 0.8
    })
    await settleFrames(page)
    await measureScrollSettlement(page, cdp, 'before-rapid-movement')
    await observeOrdinaryRowBound(page)
    const movement = await page.locator(TRANSCRIPT).evaluate(async (transcript) => {
      const initial = new Set(
        Array.from(transcript.querySelectorAll<HTMLElement>('.risu-chat[data-risu-message-id]')).map(
          (row) => row.dataset.risuMessageId,
        ),
      )
      const samples: Array<{ frame: number; index: number; id: string; text: string; busy: boolean }> = []
      transcript.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true }))
      const range = transcript.scrollHeight - transcript.clientHeight
      for (let frame = 0; frame < 48; frame++) {
        transcript.scrollTop = -range * (0.35 + 0.2 * Math.sin(frame / 4))
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const viewport = transcript.getBoundingClientRect()
        for (const row of transcript.querySelectorAll<HTMLElement>('.risu-chat[data-risu-message-id]')) {
          const bounds = row.getBoundingClientRect()
          const text = row.querySelector('.chat-message-body')?.textContent ?? ''
          const id = row.dataset.risuMessageId!
          if (initial.has(id) || bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) continue
          samples.push({
            frame,
            index: Number(row.dataset.chatIndex),
            id,
            text,
            busy: transcript.querySelector('[data-transcript-window-rows]')?.getAttribute('aria-busy') === 'true',
          })
        }
      }
      return samples
    })
    const settlement = await measureScrollSettlement(page, cdp, 'rapid-movement')
    const movementReport = { source: sourceAnchor(), movement, settlement }
    const directory = path.resolve('fast-bootstrap-results/maintainability')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      path.join(directory, 'transcript-rapid-movement.json'),
      `${JSON.stringify(movementReport, null, 2)}\n`,
    )
    await testInfo.attach('rapid-movement-visible-messages', {
      body: Buffer.from(JSON.stringify(movementReport, null, 2)),
      contentType: 'application/json',
    })
    const readableMovement = movement.filter((sample) => sample.text.trim())
    expect(
      readableMovement.some((sample) => sample.busy),
      'promoted readable rows appear before admission finishes',
    ).toBe(true)
    for (const sample of readableMovement) {
      expect(sample.id).toBe(`residency-message-${sample.index}`)
      expect(sample.text).toContain(`Residency row ${sample.index}.`)
    }
    expect(settlement.windowRows).toBe(180)
    await assertObservedOrdinaryRowBound(page)
    expect(errors).toEqual([])
  } finally {
    harness.releaseAll()
    await context.close()
    await closeFastBootstrapHarness(harness)
  }
})

async function readFoldGeometry(page: Page) {
  return page.locator(`${ROWS}[data-chat-index="5"]`).evaluate((row) => {
    const transcript = row.closest('[data-default-chat-transcript]')!
    const wrapper = row.closest('.chat-message-container')!
    return {
      top: row.getBoundingClientRect().top - transcript.getBoundingClientRect().top,
      height: row.getBoundingClientRect().height,
      wrapperTop: wrapper.getBoundingClientRect().top - transcript.getBoundingClientRect().top,
      wrapperHeight: wrapper.getBoundingClientRect().height,
      scrollTop: transcript.scrollTop,
      scrollHeight: transcript.scrollHeight,
    }
  })
}

async function bookmarkJump(page: Page, testInfo: TestInfo): Promise<void> {
  const expand = page.locator('[data-risu-sidebar-toggle="expand"]')
  if (await expand.isVisible()) await expand.click()
  await page.locator('[data-risu-chat-action="back-to-chat-list"]').click()
  await page.locator('[data-risu-chat-action="bookmarks"]').click()
  await page
    .locator('[data-risu-bookmark-id="residency-message-5"]')
    .getByRole('button', { name: 'Go to Chat' })
    .click()
  const sidebarDialog = page.locator('[data-risu-responsive-shell="shared-sidebar-dialog"]')
  if (await sidebarDialog.isVisible()) await page.keyboard.press('Escape')
  const target = page.locator(`${ROWS}[data-chat-index="5"]`)
  try {
    await expect(target).toHaveClass(/ring-blue-500/)
    await expect(target).toBeInViewport()
  } catch (error) {
    await recordJumpFailure(page, testInfo)
    throw error
  }
}

async function clickMessageAction(page: Page, index: number, action: 'edit' | 'copy' | 'branch'): Promise<void> {
  const row = page.locator(`${ROWS}[data-chat-index="${index}"]`)
  const selector = `[data-risu-message-action="${action}"]`
  const direct = row.locator(selector)
  if (await direct.count()) await direct.click()
  else {
    await row.getByRole('button', { name: 'More actions', exact: true }).click()
    await page.locator('#risu-popup-menu').locator(selector).click()
  }
}

async function scrollToLatestEdge(page: Page): Promise<void> {
  await page.locator(TRANSCRIPT).evaluate((transcript) => {
    transcript.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true }))
    transcript.scrollTop = 0
    transcript.dispatchEvent(new Event('scroll'))
  })
  await settleFrames(page)
}

async function observeOrdinaryRowBound(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = { peakOrdinaryRows: 0, peakCaptureRows: 0, observer: null as MutationObserver | null }
    const sample = () => {
      const transcript = document.querySelector('[data-default-chat-transcript]')
      const mode = transcript?.querySelector<HTMLElement>('[data-transcript-window-rows]')?.dataset
        .transcriptResidencyMode
      const count = Array.from(transcript?.querySelectorAll<HTMLElement>('.risu-chat[data-chat-index]') ?? []).filter(
        (row) => Number(row.dataset.chatIndex) >= 0,
      ).length
      if (mode === 'capture') state.peakCaptureRows = Math.max(state.peakCaptureRows, count)
      else state.peakOrdinaryRows = Math.max(state.peakOrdinaryRows, count)
    }
    state.observer = new MutationObserver(sample)
    state.observer.observe(document.body, { childList: true, subtree: true })
    sample()
    Reflect.set(window, '__residencyOrdinaryBound', state)
  })
}

async function assertObservedOrdinaryRowBound(page: Page, expectCapture = false): Promise<void> {
  const result = await page.evaluate(() => {
    const state = Reflect.get(window, '__residencyOrdinaryBound') as {
      peakOrdinaryRows: number
      peakCaptureRows: number
      observer: MutationObserver
    }
    state.observer.disconnect()
    Reflect.deleteProperty(window, '__residencyOrdinaryBound')
    return { ordinary: state.peakOrdinaryRows, capture: state.peakCaptureRows }
  })
  expect(result.ordinary).toBeGreaterThan(0)
  expect(result.ordinary).toBeLessThanOrEqual(ORDINARY_ROW_LIMIT)
  if (expectCapture) expect(result.capture).toBe(90)
}

async function waitForReady(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__?.isLoaded() ?? false), { timeout: 30_000 })
    .toBe(true)
  await expect(page.locator(TRANSCRIPT)).toBeVisible()
}

async function windowRows(page: Page): Promise<number> {
  const value = await page.locator(WINDOW).getAttribute('data-transcript-window-rows')
  expect(value).not.toBeNull()
  return Number(value)
}

async function recordJumpFailure(page: Page, testInfo: TestInfo): Promise<void> {
  const geometry = await page.evaluate(() => {
    const target = document.querySelector('.risu-chat[data-chat-index="5"]')
    const ancestors = []
    for (let element = target; element; element = element.parentElement) {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      ancestors.push({
        tag: element.tagName,
        className: element.className,
        rect: { top: rect.top, left: rect.left, height: rect.height, width: rect.width },
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        overflow: style.overflow,
        transform: style.transform,
      })
    }
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-default-chat-transcript] .risu-chat')).map(
      (row) => ({ index: row.dataset.chatIndex, top: row.getBoundingClientRect().top }),
    )
    return {
      width: innerWidth,
      height: innerHeight,
      scrollX,
      scrollY,
      ancestors,
      rows,
      timeline: Reflect.get(window, '__residencyScrollDiagnostics'),
    }
  })
  await testInfo.attach('jump-failure-geometry', {
    body: Buffer.from(JSON.stringify(geometry, null, 2)),
    contentType: 'application/json',
  })
  await testInfo.attach('jump-failure-screenshot', { body: await page.screenshot(), contentType: 'image/png' })
  console.error('Transcript jump failure geometry:', JSON.stringify(geometry))
}

async function installScrollDiagnostics(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const timeline: unknown[] = []
    Reflect.set(window, '__residencyScrollDiagnostics', timeline)
    function record(operation: string, element: Element, value?: unknown) {
      if (timeline.length >= 400) timeline.shift()
      timeline.push({
        operation,
        time: performance.now(),
        value,
        index: element.getAttribute('data-chat-index'),
        top: element.getBoundingClientRect().top,
        scrollTop: document.querySelector('[data-default-chat-transcript]')?.scrollTop,
        stack: new Error().stack?.split('\n').slice(2, 6),
      })
    }
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (...args) {
      const tracked = this.hasAttribute('data-chat-index')
      if (tracked) record('scrollIntoView:before', this, args)
      originalScrollIntoView.apply(this, args)
      if (tracked) record('scrollIntoView:after', this, args)
    }
    const originalScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!
    Object.defineProperty(Element.prototype, 'scrollTop', {
      ...originalScrollTop,
      set(value: number) {
        const tracked = (this as Element).hasAttribute('data-default-chat-transcript')
        if (tracked) record('scrollTop:before', this, value)
        originalScrollTop.set!.call(this, value)
        if (tracked) record('scrollTop:after', this, value)
      },
    })
  })
}

async function waitForRenderedRows(page: Page, timeout = 30_000): Promise<void> {
  await expect
    .poll(
      () =>
        page
          .locator(ROWS)
          .evaluateAll(
            (rows) =>
              rows.length > 0 &&
              rows.every((row) => row.querySelector('.chat-message-body')?.textContent?.includes('Residency row')),
          ),
      { timeout },
    )
    .toBe(true)
  await expect
    .poll(() =>
      page
        .locator(`${ROWS} img[alt^="Residency image"]`)
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true)
  await settleFrames(page)
}

async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      ),
  )
}

async function currentAnchor(page: Page): Promise<Anchor | null> {
  return page.locator(TRANSCRIPT).evaluate((transcript) => {
    const top = transcript.getBoundingClientRect().top
    const row = Array.from(transcript.querySelectorAll<HTMLElement>('.risu-chat[data-risu-message-id]')).find(
      (candidate) =>
        candidate.getBoundingClientRect().bottom > top &&
        candidate.getBoundingClientRect().top < transcript.getBoundingClientRect().bottom,
    )
    return row ? { id: row.dataset.risuMessageId!, top: row.getBoundingClientRect().top - top } : null
  })
}

async function scrollToOlderEdge(page: Page): Promise<Anchor | null> {
  return page.locator(TRANSCRIPT).evaluate((transcript) => {
    transcript.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }))
    transcript.scrollTop = -transcript.scrollHeight
    const rows = transcript.querySelectorAll<HTMLElement>('.risu-chat[data-risu-message-id]')
    const oldest = rows.item(rows.length - 1)
    const anchor = oldest
      ? {
          id: oldest.dataset.risuMessageId!,
          top: oldest.getBoundingClientRect().top - transcript.getBoundingClientRect().top,
        }
      : null
    transcript.dispatchEvent(new Event('scroll'))
    return anchor
  })
}

async function readMetrics(cdp: CDPSession): Promise<Metrics> {
  const result = (await cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> }
  return Object.fromEntries(result.metrics.map(({ name, value }) => [name, value]))
}

async function measure(
  page: Page,
  cdp: CDPSession,
  name: string,
  action: () => Promise<void>,
  anchor: () => Anchor | null = () => null,
): Promise<Stage> {
  const before = await readMetrics(cdp)
  const start = await page.evaluate(() => performance.now())
  try {
    await action()
    return await snapshot(page, cdp, name, start, before, anchor())
  } catch (error) {
    if (error instanceof Error && !failedStages.has(error)) {
      // A timeout or action assertion can fail before its normal snapshot.
      // Only this failure path performs the extra diagnostic sampling.
      try {
        const anchored = anchor()
        const stage = await snapshot(page, cdp, name, start, before, anchored, false)
        failedStages.set(error, { stage, anchor: anchored })
      } catch {
        // A closed browser must not replace the original action failure.
      }
    }
    throw error
  }
}

async function snapshot(
  page: Page,
  cdp: CDPSession,
  name: string,
  startedAtMs: number,
  before: Metrics,
  anchor: Anchor | null = null,
  verify = true,
): Promise<Stage> {
  const dom = await page.evaluate(
    (input) => {
      const transcript = document.querySelector('[data-default-chat-transcript]')
      const windowOwner = transcript?.querySelector<HTMLElement>('[data-transcript-window-rows]')
      const rows = Array.from(transcript?.querySelectorAll<HTMLElement>('.risu-chat[data-chat-index]') ?? []).filter(
        (row) => Number(row.dataset.chatIndex) >= 0,
      )
      const heights = rows.map((row) => row.getBoundingClientRect().height)
      const anchored = input.anchor ? rows.find((row) => row.dataset.risuMessageId === input.anchor!.id) : null
      const resources = performance
        .getEntriesByType('resource')
        .filter(
          (entry) =>
            entry.startTime >= input.startedAtMs &&
            /\/api\/v1\/chats\/[^/]+\/(messages|display-sources)/.test(entry.name),
        )
        .map((entry) => {
          const resource = entry as PerformanceResourceTiming
          return {
            path: new URL(entry.name).pathname,
            durationMs: entry.duration,
            responseEndMs: resource.responseEnd,
            transferBytes: resource.transferSize,
          }
        })
      const ended = performance.now()
      return {
        mountedRows: rows.length,
        windowRows: Number(windowOwner?.dataset.transcriptWindowRows ?? 0),
        residencyMode: windowOwner?.dataset.transcriptResidencyMode ?? null,
        transcriptElements: transcript?.querySelectorAll('*').length ?? 0,
        documentElements: document.querySelectorAll('*').length,
        rowHeightRange: {
          min: heights.length ? Math.min(...heights) : 0,
          max: heights.length ? Math.max(...heights) : 0,
        },
        elapsedMs: ended - input.startedAtMs,
        resources,
        responseEndToSettledMs: resources.length
          ? ended - Math.max(...resources.map((resource) => resource.responseEndMs))
          : null,
        anchorDeltaPx:
          anchored && input.anchor && transcript
            ? anchored.getBoundingClientRect().top - transcript.getBoundingClientRect().top - input.anchor.top
            : null,
      }
    },
    { startedAtMs, anchor },
  )
  const metrics = await readMetrics(cdp)
  const heap = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number }
  const counters = (await cdp.send('Memory.getDOMCounters')) as { nodes: number }
  const delta = (key: string) => ((metrics[key] ?? 0) - (before[key] ?? 0)) * 1000
  const stage: Stage = {
    name,
    startedAtMs,
    ...dom,
    heapUsedBytes: heap.usedSize,
    domNodes: counters.nodes,
    layoutMs: delta('LayoutDuration'),
    styleMs: delta('RecalcStyleDuration'),
    scriptMs: delta('ScriptDuration'),
    taskMs: delta('TaskDuration'),
  }
  if (verify) {
    try {
      if (!LEGACY_PAGING && dom.residencyMode !== 'capture') {
        expect(dom.mountedRows, `${name}: ordinary mounted rows`).toBeLessThanOrEqual(ORDINARY_ROW_LIMIT)
      }
      if (anchor) {
        expect(dom.anchorDeltaPx, `${name}: anchor ${anchor.id} remains mounted`).not.toBeNull()
        expect(Math.abs(dom.anchorDeltaPx!), `${name}: anchor drift`).toBeLessThanOrEqual(1)
      }
    } catch (error) {
      if (error instanceof Error) failedStages.set(error, { stage, anchor })
      throw error
    }
  }
  return stage
}

async function recordJourneyFailure(
  page: Page,
  testInfo: TestInfo,
  error: unknown,
  completed: Record<string, unknown>,
) {
  const geometry = await page
    .evaluate(() => {
      const transcript = document.querySelector('[data-default-chat-transcript]')
      if (!transcript) return { transcriptMissing: true }
      const viewport = transcript.getBoundingClientRect()
      return {
        capturedAtMs: performance.now(),
        scrollTop: transcript.scrollTop,
        scrollHeight: transcript.scrollHeight,
        clientHeight: transcript.clientHeight,
        busy: transcript.querySelector('[data-transcript-window-rows]')?.getAttribute('aria-busy'),
        rows: Array.from(transcript.querySelectorAll<HTMLElement>('[data-transcript-row-id]')).map((wrapper) => {
          const row = wrapper.querySelector<HTMLElement>('.risu-chat[data-chat-index]')
          const bounds = wrapper.getBoundingClientRect()
          return {
            id: wrapper.dataset.transcriptRowId,
            index: row?.dataset.chatIndex,
            top: bounds.top - viewport.top,
            height: bounds.height,
            text: row?.querySelector('.chat-message-body')?.textContent,
          }
        }),
        spacers: Array.from(transcript.querySelectorAll('[data-transcript-spacer]')).map((spacer) => {
          const bounds = spacer.getBoundingClientRect()
          return { top: bounds.top - viewport.top, height: bounds.height }
        }),
      }
    })
    .catch((captureError) => ({ captureError: String(captureError) }))
  const report = {
    status: 'failed',
    ...completed,
    failedStage: error instanceof Error ? failedStages.get(error) : undefined,
    failedScroll: error instanceof Error ? failedScrolls.get(error) : undefined,
    failureGeometry: geometry,
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
    attribution:
      'Failed-stage counters precede their assertions. Detailed geometry is captured after failure; no extra sampling or file writes occur on the successful measurement path.',
  }
  const directory = path.resolve('fast-bootstrap-results/maintainability/transcript-failures')
  mkdirSync(directory, { recursive: true })
  const reportPath = path.join(directory, `${testInfo.title.replace(/[^a-zA-Z0-9-]+/g, '-')}-${Date.now()}.json`)
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.error('Transcript partial failure report:', reportPath)
  await testInfo.attach('transcript-partial-failure', { path: reportPath, contentType: 'application/json' })
}

async function retainedHeap(cdp: CDPSession): Promise<{ usedSize: number; totalSize: number }> {
  // Forced GC is outside measured stages. JS heap excludes native image/canvas memory.
  await cdp.send('HeapProfiler.collectGarbage')
  return (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number; totalSize: number }
}

async function sampleScrolling(page: Page, cdp: CDPSession, phase: 'accumulated' | 'final') {
  const before = await readMetrics(cdp)
  let cpuProfilePath: string | undefined
  if (CPU_PROFILE) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.start')
  }
  let frames: number[]
  try {
    frames = await page.locator(TRANSCRIPT).evaluate(async (transcript) => {
      transcript.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }))
      const range = transcript.scrollHeight - transcript.clientHeight
      const samples: number[] = []
      let previous = performance.now()
      // Stay away from the older-page trigger. A fixed 48-frame sweep compares the
      // same geometry operation at every residency size without timing ceilings.
      for (let index = 0; index < 48; index++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        transcript.scrollTop = -range * (0.35 + 0.2 * Math.sin(index / 4))
        const now = performance.now()
        samples.push(now - previous)
        previous = now
      }
      return samples
    })
  } finally {
    if (CPU_PROFILE) {
      const { profile } = await cdp.send('Profiler.stop')
      await cdp.send('Profiler.disable')
      const directory = path.resolve('fast-bootstrap-results/maintainability/transcript-cpu-profiles')
      mkdirSync(directory, { recursive: true })
      cpuProfilePath = path.join(directory, `${test.info().title.replace(/[^a-zA-Z0-9-]+/g, '-')}-${phase}.cpuprofile`)
      writeFileSync(cpuProfilePath, `${JSON.stringify(profile)}\n`)
      await test.info().attach(`scroll-${phase}-diagnostic-cpu-profile`, {
        path: cpuProfilePath,
        contentType: 'application/json',
      })
    }
  }
  const after = await readMetrics(cdp)
  const sorted = [...frames].sort((a, b) => a - b)
  const scroll = {
    ...(cpuProfilePath ? { diagnosticCpuProfile: cpuProfilePath } : {}),
    frameIntervalsMs: frames,
    p50Ms: sorted[Math.floor(sorted.length * 0.5)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    maxMs: sorted.at(-1),
    layoutMs: ((after.LayoutDuration ?? 0) - (before.LayoutDuration ?? 0)) * 1000,
    styleMs: ((after.RecalcStyleDuration ?? 0) - (before.RecalcStyleDuration ?? 0)) * 1000,
  }
  try {
    const settlement = await measureScrollSettlement(page, cdp, phase)
    return { ...scroll, settlement }
  } catch (error) {
    if (error instanceof Error) failedScrolls.set(error, { phase, ...scroll })
    throw error
  }
}

async function measureScrollSettlement(page: Page, cdp: CDPSession, phase: string) {
  let viewport: Awaited<ReturnType<typeof visibleTranscriptCoverage>> | undefined
  const stage = await measure(page, cdp, `${phase}-scroll-settlement`, async () => {
    await expect(page.locator(WINDOW)).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
    await waitForRenderedRows(page)
    await expect(page.locator(WINDOW)).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
    viewport = await visibleTranscriptCoverage(page)
    expect(viewport.visibleRows.length, 'settled viewport has readable message rows').toBeGreaterThan(0)
    expect(viewport.spacerPixels, 'settled viewport contains no unmounted message gap').toBeLessThanOrEqual(1)
    expect(viewport.coveredPixels, 'settled row wrappers cover the viewport').toBeGreaterThanOrEqual(
      viewport.height - 1,
    )
    for (const row of viewport.visibleRows) {
      expect(row.text.trim(), `settled visible message ${row.id} has rendered text`).not.toBe('')
      if (row.id?.startsWith('residency-message-')) {
        expect(row.id).toBe(`residency-message-${row.index}`)
        expect(row.text).toContain(`Residency row ${row.index}.`)
      }
    }
  })
  return { ...stage, viewport: viewport! }
}

async function visibleTranscriptCoverage(page: Page) {
  return page.locator(TRANSCRIPT).evaluate((transcript) => {
    const viewport = transcript.getBoundingClientRect()
    const visibleRows = Array.from(transcript.querySelectorAll<HTMLElement>('[data-transcript-row-id]'))
      .map((wrapper) => {
        const row = wrapper.querySelector<HTMLElement>('.risu-chat[data-chat-index]')
        const bounds = wrapper.getBoundingClientRect()
        return {
          id: row?.dataset.risuMessageId ?? null,
          index: Number(row?.dataset.chatIndex ?? -1),
          text: row?.querySelector('.chat-message-body')?.textContent ?? '',
          top: Math.max(bounds.top, viewport.top) - viewport.top,
          bottom: Math.min(bounds.bottom, viewport.bottom) - viewport.top,
        }
      })
      .filter((row) => row.index >= 0 && row.bottom > row.top)
      .sort((left, right) => left.top - right.top)
    let coveredPixels = 0
    let coveredEnd = 0
    for (const row of visibleRows) {
      coveredPixels += Math.max(0, row.bottom - Math.max(coveredEnd, row.top))
      coveredEnd = Math.max(coveredEnd, row.bottom)
    }
    const spacerPixels = Array.from(transcript.querySelectorAll('[data-transcript-spacer]')).reduce((total, spacer) => {
      const bounds = spacer.getBoundingClientRect()
      return total + Math.max(0, Math.min(bounds.bottom, viewport.bottom) - Math.max(bounds.top, viewport.top))
    }, 0)
    return { height: viewport.height, coveredPixels, spacerPixels, visibleRows }
  })
}

async function configureGeneration(page: Page): Promise<void> {
  const result = await page.evaluate(async (chatId) => {
    const headers = await window.__RISU_FASTIFY_BROWSER_SMOKE__!.activeWriterHeaders()
    let baseRevision = (await (await fetch('/api/v1/bootstrap', { headers })).json()).revision
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await fetch(`/api/v1/commands/chats/${chatId}/generation-settings`, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          baseRevision,
          generationSettings: {
            configured: true,
            personaId: 'residency-persona',
            modelPresetId: 'residency-model',
            promptPresetId: 'residency-prompt',
            jailbreakToggle: false,
            sidebarToggles: {},
          },
        }),
      })
      const body = await response.json()
      if (response.status !== 409 || body.error !== 'revision_conflict') return { status: response.status, body }
      baseRevision = body.currentRevision
    }
    throw new Error('Residency generation settings revision retries exhausted')
  }, RESIDENCY_CHAT_ID)
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  await expect
    .poll(() =>
      page.evaluate(
        (chatId) =>
          window
            .__RISU_FASTIFY_BROWSER_SMOKE__!.getDatabaseSnapshot()
            .characters.flatMap((character) => character.chats)
            .find((chat) => chat.id === chatId)?.generationSettings?.configured,
        RESIDENCY_CHAT_ID,
      ),
    )
    .toBe(true)
}

function sourceAnchor(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

async function attachReport(testInfo: TestInfo, report: unknown): Promise<void> {
  reports.push(report)
  const directory = path.resolve('fast-bootstrap-results/maintainability')
  mkdirSync(directory, { recursive: true })
  const reportName = CPU_PROFILE ? 'transcript-residency-cpu-profile.json' : 'transcript-residency.json'
  writeFileSync(path.join(directory, reportName), `${JSON.stringify({ cases: reports }, null, 2)}\n`)
  await testInfo.attach('transcript-residency', {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: 'application/json',
  })
}
