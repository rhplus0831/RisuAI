import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

// requestChatData is the boundary the helper crosses. A hoisted holder lets
// each test stage a return value (success / streaming / multiline / fail) and
// observe the captured arg payload + abortSignal.
const providerState = vi.hoisted(() => ({
  next: null as unknown,
  calls: [] as { arg: unknown; mode: string; signal: AbortSignal | null }[],
}))
vi.mock('../request/request', () => ({
  requestChatData: async (
    arg: unknown,
    mode: string,
    signal: AbortSignal | null,
  ): Promise<unknown> => {
    providerState.calls.push({ arg, mode, signal })
    return providerState.next
  },
}))

vi.mock('../models/modelString', () => ({
  getGenerationModelString: (override?: string) =>
    override ? `model:${override}` : 'model:default',
}))

import {
  setDatabase,
  type Database,
  type character,
} from '../../storage/database.svelte'
import type { OpenAIChat } from '../index.svelte'
import {
  dispatchRequest,
  type DispatchRequestResult,
} from '../dispatch/dispatchRequest'

function makeChar(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    chaId: 'cha-1',
    desc: '',
    chats: [],
    chatPage: 0,
    customscript: [],
    triggerscript: [],
    exampleMessage: '',
    ...overrides,
  } as unknown as character
}

function seedDb(extra: Partial<Database> = {}) {
  setDatabase({
    aiModel: 'gpt-4o',
    subModel: 'gpt-4o',
    characters: [makeChar()],
    ...extra,
  } as unknown as Database)
}

function makeStageTimings(stage1 = 11, stage2 = 22) {
  return { stage1Duration: stage1, stage2Duration: stage2, stage3Start: 0 }
}

interface Recorder {
  stages: number[]
  setProcessStage: (n: number) => void
}
function makeRecorder(): Recorder {
  const stages: number[] = []
  return { stages, setProcessStage: (n) => stages.push(n) }
}

function baseArgs(over: Partial<Parameters<typeof dispatchRequest>[0]> = {}) {
  const rec = makeRecorder()
  const stageTimings = makeStageTimings()
  return {
    args: {
      formated: [{ role: 'user', content: 'hi' }] as OpenAIChat[],
      biases: [] as [string, number][],
      currentChar: makeChar(),
      nowChatroom: makeChar(),
      inputTokens: 5,
      outputTokens: 200,
      maxContextTokens: 4000,
      stageTimings,
      abortSignal: new AbortController().signal,
      isContinue: false,
      isPreview: false,
      isPreviewPrompt: false,
      setProcessStage: rec.setProcessStage,
      ...over,
    },
    rec,
    stageTimings,
  }
}

beforeEach(() => {
  providerState.next = null
  providerState.calls = []
})

describe('dispatchRequest - preview branch', () => {
  it('returns preview without calling requestChatData', async () => {
    seedDb()
    const { args, rec, stageTimings } = baseArgs({ isPreview: true })

    const result = await dispatchRequest(args)

    expect(result.status).toBe('preview')
    expect((result as Extract<DispatchRequestResult, { status: 'preview' }>).formated).toBe(
      args.formated,
    )
    expect(providerState.calls).toEqual([])
    expect(rec.stages).toEqual([3])
    expect(stageTimings.stage3Start).toBeGreaterThan(0)
  })
})

describe('dispatchRequest - previewPrompt branch', () => {
  it('returns previewPrompt body when provider succeeds with type=success', async () => {
    seedDb()
    providerState.next = { type: 'success', result: 'preview-text' }

    const { args } = baseArgs({ isPreviewPrompt: true })
    const result = await dispatchRequest(args)

    expect(result.status).toBe('previewPrompt')
    expect(
      (result as Extract<DispatchRequestResult, { status: 'previewPrompt' }>).body,
    ).toBe('preview-text')
    // requestChatData was called with previewBody: true.
    expect(providerState.calls).toHaveLength(1)
    expect(
      (providerState.calls[0].arg as { previewBody: boolean }).previewBody,
    ).toBe(true)
  })

  it('falls through to failed when previewPrompt+provider fail', async () => {
    seedDb()
    providerState.next = { type: 'fail', result: 'upstream broke' }

    const { args } = baseArgs({ isPreviewPrompt: true })
    const result = await dispatchRequest(args)

    expect(result.status).toBe('failed')
    expect(
      (result as Extract<DispatchRequestResult, { status: 'failed' }>).reason,
    ).toBe('upstream broke')
  })
})

describe('dispatchRequest - success branches', () => {
  it('returns success with streaming req', async () => {
    seedDb()
    providerState.next = { type: 'streaming', result: 'fake-stream' }

    const { args } = baseArgs()
    const result = await dispatchRequest(args)

    expect(result.status).toBe('success')
    if (result.status !== 'success') throw new Error('unexpected status')
    expect(result.req.type).toBe('streaming')
    expect(result.generationInfo.model).toBe('model:default')
    expect(result.generationInfo.inputTokens).toBe(5)
    expect(result.generationInfo.stageTiming).toEqual({
      stage1: 11,
      stage2: 22,
      stage3: 0,
      stage4: 0,
    })
    expect(typeof result.generationId).toBe('string')
  })

  it('returns success with multiline req', async () => {
    seedDb()
    providerState.next = {
      type: 'multiline',
      result: [
        ['char', 'one'],
        ['char', 'two'],
      ],
    }

    const { args } = baseArgs()
    const result = await dispatchRequest(args)

    expect(result.status).toBe('success')
    if (result.status !== 'success') throw new Error('unexpected status')
    expect(result.req.type).toBe('multiline')
  })

  it('returns success with non-streaming success req when previewPrompt is off', async () => {
    seedDb()
    providerState.next = { type: 'success', result: 'plain text' }

    const { args } = baseArgs()
    const result = await dispatchRequest(args)

    expect(result.status).toBe('success')
    if (result.status !== 'success') throw new Error('unexpected status')
    expect(result.req.type).toBe('success')
  })

  it('propagates req.model override into generationInfo.model', async () => {
    seedDb()
    providerState.next = {
      type: 'streaming',
      result: 'x',
      model: 'gpt-fallback',
    }

    const { args } = baseArgs()
    const result = await dispatchRequest(args)

    if (result.status !== 'success') throw new Error('unexpected status')
    expect(result.generationInfo.model).toBe('model:gpt-fallback')
  })
})

describe('dispatchRequest - failure branches', () => {
  it('returns failed when req.type=fail and carries the failure generationInfo', async () => {
    seedDb()
    providerState.next = { type: 'fail', result: 'boom' }

    const { args } = baseArgs()
    const result = await dispatchRequest(args)

    expect(result.status).toBe('failed')
    if (result.status !== 'failed') throw new Error('unexpected status')
    expect(result.reason).toBe('boom')
    // generationInfo is populated even on failure (consumer attaches it to
    // throwError/error message reporting).
    expect(result.generationInfo.model).toBe('model:default')
    expect(result.generationInfo.inputTokens).toBe(5)
  })

  it('returns aborted when signal trips after the provider returns', async () => {
    seedDb()
    const controller = new AbortController()
    providerState.next = { type: 'streaming', result: 'x' }
    // Abort BEFORE the helper runs; the mocked provider ignores the signal,
    // so the helper observes aborted=true on its post-provider check.
    controller.abort()

    const { args } = baseArgs({ abortSignal: controller.signal })
    const result = await dispatchRequest(args)

    expect(result.status).toBe('aborted')
  })

  it('previewPrompt has priority over abort: if previewPrompt+success, returns previewPrompt even when signal is aborted', async () => {
    seedDb()
    const controller = new AbortController()
    controller.abort()
    providerState.next = { type: 'success', result: 'preview-text' }

    const { args } = baseArgs({
      isPreviewPrompt: true,
      abortSignal: controller.signal,
    })
    const result = await dispatchRequest(args)

    expect(result.status).toBe('previewPrompt')
  })
})

describe('dispatchRequest - request payload', () => {
  it('passes formated, biases, isContinue, and escape flag through to requestChatData', async () => {
    seedDb()
    providerState.next = { type: 'streaming', result: 'x' }
    const formated: OpenAIChat[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]

    const { args } = baseArgs({
      formated,
      biases: [['avoid', -100]],
      isContinue: true,
      nowChatroom: makeChar({
        type: 'character',
        escapeOutput: true,
      } as Partial<character>),
    })
    await dispatchRequest(args)

    expect(providerState.calls).toHaveLength(1)
    const payload = providerState.calls[0].arg as Record<string, unknown>
    expect(payload.formated).toBe(formated)
    expect(payload.biasString).toEqual([['avoid', -100]])
    expect(payload.continue).toBe(true)
    expect(payload.escape).toBe(true)
    expect(payload.useStreaming).toBe(true)
    expect(payload.isGroupChat).toBe(false)
  })
})
