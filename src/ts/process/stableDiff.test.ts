import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  alertError: vi.fn(),
  charEmotionValue: {} as Record<string, unknown>,
  charEmotionSet: vi.fn((value: Record<string, unknown>) => {
    state.charEmotionValue = value
  }),
  db: {} as any,
  fetchNative: vi.fn(),
  globalFetch: vi.fn(),
  processZip: vi.fn(async () => 'data:image/png;base64,zip-image'),
  readImage: vi.fn(),
  requestChatData: vi.fn(),
}))

vi.mock('../alert', () => ({
  alertError: state.alertError,
}))

vi.mock('../globalApi.svelte', () => ({
  fetchNative: state.fetchNative,
  globalFetch: state.globalFetch,
  readImage: state.readImage,
}))

vi.mock('../storage/database.svelte', () => ({
  getDatabase: () => state.db,
}))

vi.mock('../stores.svelte', () => ({
  CharEmotion: {
    subscribe(fn: (value: Record<string, unknown>) => void) {
      fn(state.charEmotionValue)
      return () => {}
    },
    set: state.charEmotionSet,
  },
}))

vi.mock('./request/request', () => ({
  requestChatData: state.requestChatData,
}))

vi.mock('./processzip', () => ({
  processZip: state.processZip,
}))

vi.mock('../kei/kei', () => ({
  keiServerURL: () => 'https://kei.example.test',
}))

vi.mock('lodash/random', () => ({
  default: () => 42,
}))

import { generateAIImage, loadStableDiffReferenceImageForTests } from './stableDiff'
import type { character } from '../storage/database.svelte'

function makeCharacter(): character {
  return {
    chaId: 'char-img',
    image: 'char.png',
    newGenData: {
      instructions: 'describe',
      negative: '',
      prompt: '{{slot}}',
    },
  } as unknown as character
}

function seedNovelAiDb(extra: Record<string, unknown> = {}) {
  state.db = {
    sdProvider: 'novelai',
    NAIApiKey: 'nai-key',
    NAIImgModel: 'nai-diffusion-3',
    NAIImgUrl: 'https://novelai.example.test/generate',
    NAII2I: false,
    NAIImgConfig: {
      cfg_rescale: 0,
      decrisp: false,
      height: 512,
      width: 512,
      sampler: 'k_euler',
      steps: 10,
      scale: 5,
      sm: false,
      sm_dyn: false,
      noise_schedule: 'native',
      legacy_uc: false,
      variety_plus: false,
      reference_mode: 'none',
      vibe_data: null,
      image: '',
      base64image: '',
      strength: 0.7,
      noise: 0,
      ...extra,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.charEmotionValue = {}
  state.db = {}
})

describe('stableDiff image-generation hygiene', () => {
  it('L50: image generation providers do not console-log payloads or poll bodies', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const char = makeCharacter()
    try {
      seedNovelAiDb()
      state.globalFetch.mockResolvedValueOnce({
        ok: true,
        data: new Uint8Array([1, 2, 3]),
      })
      await expect(generateAIImage('prompt', char, 'neg', 'inlay')).resolves.toMatch(/^data:image\/png;base64,/)

      state.db = {
        sdProvider: 'dalle',
        openAIKey: 'openai-key',
        dallEQuality: 'standard',
      }
      state.globalFetch.mockResolvedValueOnce({
        ok: true,
        data: { data: [{ b64_json: 'dalle-image' }] },
      })
      await expect(generateAIImage('prompt', char, 'neg', 'inlay')).resolves.toBe('data:image/png;base64,dalle-image')

      state.db = {
        sdProvider: 'comfyui',
        comfyUiUrl: 'https://comfy.example.test',
        comfyConfig: {
          workflow: JSON.stringify({
            '1': { inputs: { prompt: '{{risu_prompt}}', negative: '{{risu_neg}}', seed: 1 } },
          }),
          posNodeID: '1',
          posInputName: 'prompt',
          negNodeID: '1',
          negInputName: 'negative',
          timeout: 1,
        },
      }
      state.globalFetch.mockResolvedValueOnce({
        ok: true,
        data: { prompt_id: 'prompt-1' },
      })
      state.fetchNative
        .mockResolvedValueOnce({
          json: vi.fn(async () => ({
            'prompt-1': {
              outputs: {
                '1': {
                  images: [{ filename: 'out.png', subfolder: '', type: 'output' }],
                },
              },
            },
          })),
        })
        .mockResolvedValueOnce({
          arrayBuffer: vi.fn(async () => new Uint8Array([9, 8, 7]).buffer),
        })

      await expect(generateAIImage('prompt', char, 'neg', 'inlay')).resolves.toMatch(/^data:image\/png;base64,/)

      expect(logSpy).not.toHaveBeenCalled()
    } finally {
      logSpy.mockRestore()
    }
  })

  it('K4: reference image loading rejects onerror and timeout instead of hanging', async () => {
    class ErrorImage {
      onerror: ((event: Event) => void) | null = null
      onload: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.(new Event('error')))
      }
    }
    class NeverImage {
      onerror: ((event: Event) => void) | null = null
      onload: (() => void) | null = null
      set src(_value: string) {}
    }

    await expect(
      loadStableDiffReferenceImageForTests(
        new ErrorImage() as unknown as HTMLImageElement,
        'data:image/png;base64,bad',
        { timeoutMs: 1000 },
      ),
    ).rejects.toThrow('Reference image failed to load')

    vi.useFakeTimers()
    try {
      const pending = loadStableDiffReferenceImageForTests(
        new NeverImage() as unknown as HTMLImageElement,
        'data:image/png;base64,never',
        { timeoutMs: 1000 },
      )
      const assertion = expect(pending).rejects.toThrow('Reference image load timed out')
      await vi.advanceTimersByTimeAsync(1000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})
