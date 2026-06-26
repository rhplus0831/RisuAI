import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock all seven stage-4 delegates. The fakes record their calls and let
// tests stage return values without re-testing each helper's internals
// (covered by their own test files).
const fakes = vi.hoisted(() => ({
  notification: { calls: [] as unknown[] },
  applyEmotion: { next: false, calls: 0 },
  loadEmotion: {
    next: { tempEmotion: [] as unknown[], charemotions: {} as Record<string, unknown> },
    calls: 0,
  },
  embedding: { calls: 0 },
  llm: { calls: 0 },
  imggen: { calls: [] as unknown[] },
  finalize: { calls: [] as { stage4Duration: number; finalized: boolean }[] },
}))

vi.mock('../../postGeneration/notification', () => ({
  fireDesktopNotification: async (input: unknown) => {
    fakes.notification.calls.push(input)
  },
}))

vi.mock('../postGeneration/notification', () => ({
  fireDesktopNotification: async (input: unknown) => {
    fakes.notification.calls.push(input)
  },
}))

vi.mock('../postGeneration/emotionFromResponse', () => ({
  applyEmotionFromResponse: () => {
    fakes.applyEmotion.calls++
    return fakes.applyEmotion.next
  },
}))

vi.mock('../postGeneration/charEmotionStore', () => ({
  loadAndTrimCharEmotion: () => {
    fakes.loadEmotion.calls++
    return fakes.loadEmotion.next
  },
}))

vi.mock('../postGeneration/emotionFallbackEmbedding', () => ({
  runEmotionEmbeddingFallback: async () => {
    fakes.embedding.calls++
  },
}))

vi.mock('../postGeneration/emotionFallbackLlm', () => ({
  runEmotionLlmFallback: async () => {
    fakes.llm.calls++
  },
}))

vi.mock('../postGeneration/imggenStableDiff', () => ({
  runImggenStableDiff: async (opts: unknown) => {
    fakes.imggen.calls.push(opts)
  },
}))

// finalizeStage4 still runs its real implementation for the stage4Duration
// writeback — the test passes a fresh stageTimings object so we can observe
// the mutation directly.
vi.mock('../postGeneration/stage4Finalize', async (importActual) => {
  const actual = await importActual<typeof import('../postGeneration/stage4Finalize')>()
  return {
    ...actual,
    finalizeStage4: (opts: Parameters<typeof actual.finalizeStage4>[0]) => {
      actual.finalizeStage4(opts)
      fakes.finalize.calls.push({
        stage4Duration: opts.stageTimings.stage4Duration,
        finalized: true,
      })
    },
  }
})

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

import { setDatabase, type Database, type character } from '../../storage/database.svelte'
import { runStage4 } from '../postGeneration/runStage4'
import type { DispatchSuccessReq } from '../dispatch/dispatchRequest'

function makeChar(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    chaId: 'cha-1',
    desc: '',
    chats: [
      {
        name: 'main',
        note: '',
        localLore: [],
        scriptstate: {},
        fmIndex: -1,
        message: [{ role: 'char', data: 'reply', chatId: 'm0', time: 0 }],
      },
    ],
    chatPage: 0,
    customscript: [],
    triggerscript: [],
    exampleMessage: '',
    inlayViewScreen: false,
    viewScreen: 'none',
    emotionImages: [],
    ...overrides,
  } as unknown as character
}

function seedDb(extra: Partial<Database> = {}) {
  setDatabase({
    aiModel: 'gpt-4o',
    subModel: 'gpt-4o',
    characters: [makeChar()],
    notification: false,
    emotionProcesser: 'submodel',
    ...extra,
  } as unknown as Database)
}

function makeStageTimings() {
  return {
    stage1Start: 0,
    stage2Start: 0,
    stage3Start: Date.now() - 100,
    stage4Start: 0,
    stage1Duration: 1,
    stage2Duration: 2,
    stage3Duration: 0,
    stage4Duration: 0,
  }
}

function makeGenerationInfo() {
  return {
    model: 'gpt-4o',
    generationId: 'gen-1',
    inputTokens: 10,
    outputTokens: 20,
    maxContext: 4000,
    stageTiming: { stage1: 0, stage2: 0, stage3: 0, stage4: 0 },
  }
}

function baseArgs(over: Partial<Parameters<typeof runStage4>[0]> = {}) {
  const stages: number[] = []
  return {
    args: {
      req: { type: 'success', result: 'done' } as unknown as DispatchSuccessReq,
      currentChar: makeChar(),
      result: 'rendered text',
      resendChat: false,
      emoChanged: false,
      abortSignal: new AbortController().signal,
      selectedChar: 0,
      selectedChat: 0,
      stageTimings: makeStageTimings(),
      generationInfo: makeGenerationInfo(),
      throwError: () => {},
      setProcessStage: (n: number) => stages.push(n),
      ...over,
    },
    stages,
  }
}

beforeEach(() => {
  fakes.notification.calls = []
  fakes.applyEmotion.next = false
  fakes.applyEmotion.calls = 0
  fakes.loadEmotion.calls = 0
  fakes.embedding.calls = 0
  fakes.llm.calls = 0
  fakes.imggen.calls = []
  fakes.finalize.calls = []
})

describe('runStage4 - stage transition', () => {
  it('writes stage3Duration into stageTimings + generationInfo, then flips to stage 4', async () => {
    seedDb()
    const { args, stages } = baseArgs()

    await runStage4(args)

    expect(args.stageTimings.stage3Duration).toBeGreaterThanOrEqual(0)
    expect(args.generationInfo.stageTiming?.stage3).toBe(args.stageTimings.stage3Duration)
    expect(stages).toEqual([4])
    expect(args.stageTimings.stage4Start).toBeGreaterThan(0)
  })
})

describe('runStage4 - resend handoff', () => {
  it('calls finalizeStage4 and returns resend without notifications or emotion', async () => {
    seedDb({ notification: true })
    const { args } = baseArgs({ resendChat: true })

    const result = await runStage4(args)

    expect(result).toEqual({ status: 'resend' })
    expect(fakes.finalize.calls).toHaveLength(1)
    expect(fakes.notification.calls).toEqual([])
    expect(fakes.applyEmotion.calls).toBe(0)
    expect(fakes.llm.calls).toBe(0)
    expect(fakes.embedding.calls).toBe(0)
    expect(fakes.imggen.calls).toHaveLength(0)
  })
})

describe('runStage4 - notification', () => {
  it('fires fireDesktopNotification with result when db.notification=true', async () => {
    seedDb({ notification: true })
    const { args } = baseArgs({ result: 'hello' })

    await runStage4(args)

    expect(fakes.notification.calls).toEqual([{ body: 'hello' }])
  })

  it('uses the character custom notification message and image when set', async () => {
    seedDb({ notification: true })
    const { args } = baseArgs({
      result: 'hello',
      currentChar: makeChar({
        customNotificationMessage: 'Custom completion text',
        image: 'asset-id',
      }),
    })

    await runStage4(args)

    expect(fakes.notification.calls).toEqual([{ body: 'Custom completion text', icon: 'asset-id' }])
  })

  it('skips fireDesktopNotification when db.notification=false', async () => {
    seedDb({ notification: false })
    const { args } = baseArgs({ result: 'hello' })

    await runStage4(args)

    expect(fakes.notification.calls).toEqual([])
  })
})

describe('runStage4 - provider emotion short-circuit', () => {
  it('skips emotion fallback when applyEmotionFromResponse returns true', async () => {
    seedDb({ emotionProcesser: 'submodel' })
    fakes.applyEmotion.next = true
    const { args } = baseArgs({
      req: { type: 'success', result: 'done', special: { emotion: 'happy' } } as unknown as DispatchSuccessReq,
      currentChar: makeChar({ viewScreen: 'emotion' }),
    })

    await runStage4(args)

    expect(fakes.applyEmotion.calls).toBe(1)
    expect(fakes.llm.calls).toBe(0)
    expect(fakes.embedding.calls).toBe(0)
    // Default path still finalizes.
    expect(fakes.finalize.calls).toHaveLength(1)
  })
})

describe('runStage4 - emotion fallback routing', () => {
  it('runs embedding fallback when emotionProcesser=embedding and skips finalizeStage4', async () => {
    seedDb({ emotionProcesser: 'embedding' })
    const { args } = baseArgs({
      currentChar: makeChar({ viewScreen: 'emotion' }),
    })

    const result = await runStage4(args)

    expect(result).toEqual({ status: 'done' })
    expect(fakes.embedding.calls).toBe(1)
    expect(fakes.llm.calls).toBe(0)
    // Asymmetry: emotion-fallback paths intentionally skip finalizeStage4.
    expect(fakes.finalize.calls).toHaveLength(0)
  })

  it('runs LLM fallback when emotionProcesser is anything else and skips finalizeStage4', async () => {
    seedDb({ emotionProcesser: 'submodel' })
    const { args } = baseArgs({
      currentChar: makeChar({ viewScreen: 'emotion' }),
    })

    const result = await runStage4(args)

    expect(result).toEqual({ status: 'done' })
    expect(fakes.llm.calls).toBe(1)
    expect(fakes.embedding.calls).toBe(0)
    expect(fakes.finalize.calls).toHaveLength(0)
  })

  it('skips emotion fallback when emoChanged is already true', async () => {
    seedDb({ emotionProcesser: 'submodel' })
    const { args } = baseArgs({
      emoChanged: true,
      currentChar: makeChar({ viewScreen: 'emotion' }),
    })

    await runStage4(args)

    expect(fakes.llm.calls).toBe(0)
    expect(fakes.embedding.calls).toBe(0)
    // Default finalize on fall-through.
    expect(fakes.finalize.calls).toHaveLength(1)
  })

  it('skips emotion fallback when abortSignal.aborted=true', async () => {
    seedDb({ emotionProcesser: 'submodel' })
    const ac = new AbortController()
    ac.abort()
    const { args } = baseArgs({
      abortSignal: ac.signal,
      currentChar: makeChar({ viewScreen: 'emotion' }),
    })

    await runStage4(args)

    expect(fakes.llm.calls).toBe(0)
    expect(fakes.embedding.calls).toBe(0)
    expect(fakes.finalize.calls).toHaveLength(1)
  })
})

describe('runStage4 - imggen routing', () => {
  it('calls runImggenStableDiff when viewScreen=imggen and then finalizes', async () => {
    seedDb()
    const { args } = baseArgs({
      currentChar: makeChar({ viewScreen: 'imggen' }),
    })

    const result = await runStage4(args)

    expect(result).toEqual({ status: 'done' })
    expect(fakes.imggen.calls).toHaveLength(1)
    expect(fakes.imggen.calls[0]).toMatchObject({
      abortSignal: args.abortSignal,
      currentChar: args.currentChar,
      selectedChar: 0,
      selectedChat: 0,
    })
    expect(fakes.finalize.calls).toHaveLength(1)
  })

  it('v4-L31: skips imggen post-generation work when already aborted', async () => {
    seedDb()
    const ac = new AbortController()
    ac.abort()
    const { args } = baseArgs({
      abortSignal: ac.signal,
      currentChar: makeChar({ viewScreen: 'imggen' }),
    })

    const result = await runStage4(args)

    expect(result).toEqual({ status: 'done' })
    expect(fakes.imggen.calls).toHaveLength(0)
    expect(fakes.finalize.calls).toHaveLength(1)
  })
})

describe('runStage4 - inlayViewScreen short-circuit', () => {
  it('skips all emotion/imggen processing when inlayViewScreen=true', async () => {
    seedDb({ emotionProcesser: 'submodel' })
    const { args } = baseArgs({
      currentChar: makeChar({ inlayViewScreen: true, viewScreen: 'emotion' }),
    })

    const result = await runStage4(args)

    expect(result).toEqual({ status: 'done' })
    expect(fakes.llm.calls).toBe(0)
    expect(fakes.embedding.calls).toBe(0)
    expect(fakes.imggen.calls).toHaveLength(0)
    expect(fakes.finalize.calls).toHaveLength(1)
  })
})

describe('runStage4 - default path', () => {
  it('runs finalizeStage4 and returns done when no viewScreen branch matches', async () => {
    seedDb()
    const { args } = baseArgs()

    const result = await runStage4(args)

    expect(result).toEqual({ status: 'done' })
    expect(fakes.finalize.calls).toHaveLength(1)
    expect(args.stageTimings.stage4Duration).toBeGreaterThanOrEqual(0)
  })
})
