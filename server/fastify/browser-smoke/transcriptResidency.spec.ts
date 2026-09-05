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
test.describe.configure({ mode: 'serial' })

// Opt into the complete cost matrix with RISU_TRANSCRIPT_COSTS=1 and run through
// the focused runner in isolation with RISU_BROWSER_SMOKE_WORKERS=1. Optional
// RISU_TRANSCRIPT_REPETITIONS repeats whole journeys (default: one).
// Each repetition starts with a fresh origin/context and no warmup. The reload
// before jumping is explicitly warm. These are measurements, not latency gates.
const TRANSCRIPT = '[data-default-chat-transcript]'
const ROWS = `${TRANSCRIPT} .risu-chat[data-risu-message-id^="residency-message-"]`
const MEASURE_COSTS = process.env.RISU_TRANSCRIPT_COSTS === '1'
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

for (let repetition = 0; repetition < REPETITIONS; repetition++) {
  for (const profile of PROFILES) {
    for (const messageCount of SIZES) {
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
        await context.addInitScript(() => performance.setResourceTimingBufferSize(2000))
        const page = await context.newPage()
        const cdp = await context.newCDPSession(page)
        const errors: string[] = []
        const stages: Stage[] = []
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

          let mounted = await page.locator(ROWS).count()
          let olderLoads = 0
          while (mounted < messageCount) {
            const previousMounted = mounted
            let anchor: Anchor | null = null
            stages.push(
              await measure(
                page,
                cdp,
                `older-page-${++olderLoads}`,
                async () => {
                  anchor = await scrollToOlderEdge(page)
                  await expect.poll(() => page.locator(ROWS).count()).toBeGreaterThan(previousMounted)
                  await waitForRenderedRows(page)
                },
                () => anchor,
              ),
            )
            mounted = await page.locator(ROWS).count()
            expect(mounted).toBeLessThanOrEqual(messageCount)
          }
          expect(mounted).toBe(messageCount)
          const accumulatedScroll = await sampleScrolling(page, cdp)
          const retainedAccumulated = await retainedHeap(cdp)

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
              await expect(target).toBeInViewport()
              await waitForRenderedRows(page, 30_000 * profile.cpuRate)
            }),
          )
          await expect(page.locator(ROWS)).toHaveCount(messageCount)

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
          const finalScroll = await sampleScrolling(page, cdp)
          const retainedAfterStream = await retainedHeap(cdp)
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
              'Resource durations measure hydration/display-source request delivery. responseEndToSettledMs includes scheduling, parser, mounting and image decoding; it is NOT isolated parser CPU. CDP scriptMs also includes other JavaScript. CDP layout/style are reported independently. Browser polling, CDP sampling, and three settling animation frames are included in stage wall times. Provider release is manually gated; first-chunk time can include remaining generation preparation after projected-row admission. Actual mounted counts expose any window reset on send.',
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

async function waitForReady(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__RISU_FASTIFY_BROWSER_SMOKE__?.isLoaded() ?? false), { timeout: 30_000 })
    .toBe(true)
  await expect(page.locator(TRANSCRIPT)).toBeVisible()
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
  await action()
  return snapshot(page, cdp, name, start, before, anchor())
}

async function snapshot(
  page: Page,
  cdp: CDPSession,
  name: string,
  startedAtMs: number,
  before: Metrics,
  anchor: Anchor | null = null,
): Promise<Stage> {
  const dom = await page.evaluate(
    (input) => {
      const transcript = document.querySelector('[data-default-chat-transcript]')
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
  return {
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
}

async function retainedHeap(cdp: CDPSession): Promise<{ usedSize: number; totalSize: number }> {
  // Forced GC is outside measured stages. JS heap excludes native image/canvas memory.
  await cdp.send('HeapProfiler.collectGarbage')
  return (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number; totalSize: number }
}

async function sampleScrolling(page: Page, cdp: CDPSession) {
  const before = await readMetrics(cdp)
  const frames = await page.locator(TRANSCRIPT).evaluate(async (transcript) => {
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
  const after = await readMetrics(cdp)
  const sorted = [...frames].sort((a, b) => a - b)
  return {
    frameIntervalsMs: frames,
    p50Ms: sorted[Math.floor(sorted.length * 0.5)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    maxMs: sorted.at(-1),
    layoutMs: ((after.LayoutDuration ?? 0) - (before.LayoutDuration ?? 0)) * 1000,
    styleMs: ((after.RecalcStyleDuration ?? 0) - (before.RecalcStyleDuration ?? 0)) * 1000,
  }
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
  writeFileSync(path.join(directory, 'transcript-residency.json'), `${JSON.stringify({ cases: reports }, null, 2)}\n`)
  await testInfo.attach('transcript-residency', {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: 'application/json',
  })
}
