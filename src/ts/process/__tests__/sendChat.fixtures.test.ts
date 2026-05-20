import { afterAll, afterEach, beforeAll, beforeEach, describe, it, vi } from 'vitest'

// vi.mock calls are hoisted; they take effect before any of the imports below.
vi.mock('../request/request', () => import('../__fixtures__/mocks/request'))
vi.mock('../tts', () => import('../__fixtures__/mocks/tts'))
vi.mock('../inlayScreen', () => import('../__fixtures__/mocks/inlayScreen'))
vi.mock('../stableDiff', () => import('../__fixtures__/mocks/stableDiff'))
vi.mock('../prereroll', () => import('../__fixtures__/mocks/prereroll'))

// Stable UUIDs so generationId / chatId are deterministic in snapshots.
// The counter is exposed via a reset hook so each fixture starts at uuid-0,
// keeping snapshots independent of test order.
const uuidState = { counter: 0 }
vi.mock('uuid', () => ({
  v4: () => `uuid-${uuidState.counter++}`,
}))

import { loadFixture } from '../__fixtures__/loadFixture'
import {
  installProviderScript,
  loadProviderScript,
  resetProviderState,
} from '../__fixtures__/providerFake'
import { resetSideEffectCalls } from '../__fixtures__/sideEffects'
import { assertOrRecord, captureSnapshot, recordStages } from '../__fixtures__/snapshot'
import { abortChat, chatProcessStage, doingChat, sendChat } from '../index.svelte'

const FIXTURES = [
  'simple-send',
  'preview',
  'continue',
  'regenerate',
  'provider-error',
  'auto-continue',
  'author-note',
  'cache-point',
  'persona',
  'lorebook-keyword',
  'client-abort',
] as const

describe('sendChat fixtures', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    resetProviderState()
    resetSideEffectCalls()
    // sendChat sets doingChat=true on entry and only resets it on certain exit
    // paths. Reset it explicitly so each fixture runs in a clean state.
    doingChat.set(false)
    abortChat.set(false)
    chatProcessStage.set(0)
    uuidState.counter = 0
  })

  let cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()!()
  })

  it.each(FIXTURES)('%s', async (name) => {
    const loaded = await loadFixture(name)
    cleanups.push(loaded.cleanup)

    // Preview-mode fixtures return before any provider call, so the upstream
    // script may be absent. Load it lazily and tolerate ENOENT.
    try {
      const script = await loadProviderScript(name)
      installProviderScript(script)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw err
    }

    const stageRecorder = recordStages()

    const args: Parameters<typeof sendChat>[1] = { ...(loaded.fixture.sendChatArgs ?? {}) }
    if (loaded.fixture.aborted) {
      const controller = new AbortController()
      controller.abort()
      args.signal = controller.signal
    }
    await sendChat(-1, args)

    const stages = stageRecorder.stop()
    const captured = captureSnapshot(stages)
    await assertOrRecord(name, captured)
  })
})
