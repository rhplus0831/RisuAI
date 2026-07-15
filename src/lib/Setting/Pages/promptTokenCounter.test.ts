import { describe, expect, it, vi } from 'vitest'
import { createLatestPromptTokenCounter } from './promptTokenCounter'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('prompt token count freshness', () => {
  it('discards a slower count after a newer edited prompt finishes', async () => {
    const olderMain = deferred<number>()
    const latestMain = deferred<number>()
    const tokenize = vi.fn((text: string): Promise<number> => {
      if (text === 'older main') return olderMain.promise
      if (text === 'latest main') return latestMain.promise
      if (text === 'latest jailbreak') return Promise.resolve(22)
      if (text === 'latest global note') return Promise.resolve(33)
      throw new Error(`unexpected tokenization: ${text}`)
    })
    const countTokens = createLatestPromptTokenCounter(tokenize)

    const older = countTokens({
      mainPrompt: 'older main',
      jailbreak: 'older jailbreak',
      globalNote: 'older global note',
    })
    const latest = countTokens({
      mainPrompt: 'latest main',
      jailbreak: 'latest jailbreak',
      globalNote: 'latest global note',
    })

    latestMain.resolve(11)
    await expect(latest).resolves.toEqual({ mainPrompt: 11, jailbreak: 22, globalNote: 33 })

    olderMain.resolve(99)
    await expect(older).resolves.toBeNull()
    expect(tokenize).not.toHaveBeenCalledWith('older jailbreak')
    expect(tokenize).not.toHaveBeenCalledWith('older global note')
  })
})
