import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type TranslateRequest = {
  from: string
  to: string
  text: string
  html: boolean | null
}

type TranslateResponse = {
  target: {
    text: string
  }
}

type MockTranslatorInstance = {
  id: number
  translate: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

const bergamotMock = vi.hoisted(() => {
  const instances: MockTranslatorInstance[] = []
  let constructError: Error | null = null
  const translateImpl = vi.fn(
    async (request: TranslateRequest): Promise<TranslateResponse> => ({
      target: { text: `translated:${request.to}:${request.text}` },
    }),
  )

  return {
    instances,
    translateImpl,
    get constructError() {
      return constructError
    },
    setConstructError(error: Error | null) {
      constructError = error
    },
    reset() {
      instances.length = 0
      constructError = null
      translateImpl.mockReset()
      translateImpl.mockImplementation(
        async (request: TranslateRequest): Promise<TranslateResponse> => ({
          target: { text: `translated:${request.to}:${request.text}` },
        }),
      )
    },
  }
})

vi.mock('@browsermt/bergamot-translator', () => {
  class TranslatorBacking {
    options: Record<string, unknown>
    registryUrl: string
    downloadTimeout: number

    constructor(options: Record<string, unknown> = {}) {
      this.options = options
      this.registryUrl = String(options.registryUrl ?? '')
      this.downloadTimeout = Number(options.downloadTimeout ?? 60000)
    }

    async loadModelRegistery() {
      return []
    }
  }

  class LatencyOptimisedTranslator {
    id: number
    translate: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>

    constructor() {
      if (bergamotMock.constructError) {
        throw bergamotMock.constructError
      }

      this.id = bergamotMock.instances.length + 1
      this.translate = vi.fn((request: TranslateRequest) => bergamotMock.translateImpl(request))
      this.delete = vi.fn()
      bergamotMock.instances.push(this)
    }
  }

  return {
    LatencyOptimisedTranslator,
    TranslatorBacking,
  }
})

vi.mock('../util', () => ({
  asBuffer: (value: Uint8Array | ArrayBuffer) =>
    value instanceof Uint8Array ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : value,
}))

import { __bergamotTranslatorTestHooks, bergamotTranslate } from './bergamotTranslator'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('bergamotTranslate queue recovery', () => {
  beforeEach(() => {
    bergamotMock.reset()
    __bergamotTranslatorTestHooks.resetState()
  })

  afterEach(() => {
    __bergamotTranslatorTestHooks.resetState()
    vi.restoreAllMocks()
  })

  it('M19: keeps successful bergamot translations serialized in call order', async () => {
    const first = deferred<TranslateResponse>()
    const second = deferred<TranslateResponse>()
    const started: string[] = []
    bergamotMock.translateImpl.mockImplementation(async (request: TranslateRequest) => {
      started.push(request.text)
      if (request.text === 'first') {
        return first.promise
      }
      if (request.text === 'second') {
        return second.promise
      }
      throw new Error(`unexpected text ${request.text}`)
    })

    const firstResult = bergamotTranslate('first', 'en', 'ko', false)
    await flushPromises()
    const secondResult = bergamotTranslate('second', 'en', 'ja', true)
    await flushPromises()

    expect(started).toEqual(['first'])
    expect(bergamotMock.instances).toHaveLength(1)

    first.resolve({ target: { text: 'translated:first' } })
    await expect(firstResult).resolves.toBe('translated:first')
    await flushPromises()

    expect(started).toEqual(['first', 'second'])
    expect(bergamotMock.instances[0].translate).toHaveBeenNthCalledWith(2, {
      from: 'en',
      to: 'ja',
      text: 'second',
      html: true,
    })

    second.resolve({ target: { text: 'translated:second' } })
    await expect(secondResult).resolves.toBe('translated:second')
    expect(__bergamotTranslatorTestHooks.getState().hasTranslateTask).toBe(false)
  })

  it('M19: rejects the current bergamot call when the active translation fails', async () => {
    const currentError = new Error('active translation failed')
    bergamotMock.translateImpl.mockRejectedValueOnce(currentError)

    await expect(bergamotTranslate('bad', 'en', 'ko', false)).rejects.toBe(currentError)

    expect(bergamotMock.translateImpl).toHaveBeenCalledTimes(1)
    expect(bergamotMock.translateImpl).toHaveBeenCalledWith({
      from: 'en',
      to: 'ko',
      text: 'bad',
      html: false,
    })
  })

  it('M19: recovers the next bergamot call after a rejected translation', async () => {
    bergamotMock.translateImpl
      .mockRejectedValueOnce(new Error('first translation failed'))
      .mockResolvedValueOnce({ target: { text: 'translated:ok' } })

    await expect(bergamotTranslate('bad', 'en', 'ko', false)).rejects.toThrow('first translation failed')
    await expect(bergamotTranslate('ok', 'en', 'ko', false)).resolves.toBe('translated:ok')

    expect(bergamotMock.translateImpl).toHaveBeenCalledTimes(2)
    expect(bergamotMock.translateImpl).toHaveBeenNthCalledWith(2, {
      from: 'en',
      to: 'ko',
      text: 'ok',
      html: false,
    })
  })

  it('M19: re-instantiates bergamot after a simulated hard wasm failure', async () => {
    bergamotMock.translateImpl
      .mockRejectedValueOnce(new Error('WASM Translation Worker error'))
      .mockResolvedValueOnce({ target: { text: 'translated:fresh' } })

    await expect(bergamotTranslate('crash', 'en', 'ko', false)).rejects.toThrow('WASM Translation Worker error')
    await expect(bergamotTranslate('fresh', 'en', 'ko', false)).resolves.toBe('translated:fresh')

    expect(bergamotMock.instances).toHaveLength(2)
    expect(bergamotMock.instances[0].delete).toHaveBeenCalledTimes(1)
    expect(bergamotMock.instances[1].translate).toHaveBeenCalledWith({
      from: 'en',
      to: 'ko',
      text: 'fresh',
      html: false,
    })
  })
})
