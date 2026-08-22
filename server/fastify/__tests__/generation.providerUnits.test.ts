import { describe, expect, it, vi } from 'vitest'
import type { CompletionStreamFrame } from '../src/generation/frames.js'
import { emitProviderChunks } from '../src/prompt/providerTransport.js'
import { createRequestScopedStoredAssetResolver } from '../src/routes/generationChat.js'
import type { PromptChatEvent } from '../src/prompt/sseEvents.js'
import { expectNoSuccessDoneAfterAbort } from './helpers/terminalFrameAssertions.js'

describe('H1 provider transport abort contract', () => {
  it('H1: treats sliding-deadline silent transport return as aborted', async () => {
    const controller = new AbortController()
    const events: PromptChatEvent[] = []
    const sideEffects = vi.fn((): PromptChatEvent[] => [
      { type: 'side_effect', kind: 'tts', payload: { text: 'partial', characterId: 'char-1' } },
    ])
    const postGeneration = vi.fn(async () => ({ revision: 3 }))

    async function* frames(): AsyncGenerator<CompletionStreamFrame> {
      yield { kind: 'token', content: 'partial' }
      controller.abort()
    }

    const result = await emitProviderChunks(frames(), (event) => events.push(event), controller.signal, {
      doneMetadata: () => ({ generationId: 'generation-h1' }),
      sideEffects,
      postGeneration,
    })

    expect(result).toEqual({ status: 'aborted', result: 'partial' })
    expect(events).toEqual([{ type: 'token', content: 'partial' }])
    expectNoSuccessDoneAfterAbort(events)
    expect(sideEffects).not.toHaveBeenCalled()
    expect(postGeneration).not.toHaveBeenCalled()
  })

  it('H1: re-checks abort before an in-loop provider done frame', async () => {
    const controller = new AbortController()
    const events: PromptChatEvent[] = []
    const sideEffects = vi.fn((): PromptChatEvent[] => [])
    const postGeneration = vi.fn(async () => ({ revision: 4 }))

    async function* frames(): AsyncGenerator<CompletionStreamFrame> {
      yield { kind: 'token', content: 'partial' }
      controller.abort()
      yield { kind: 'done', finishReason: 'stop' }
    }

    const result = await emitProviderChunks(frames(), (event) => events.push(event), controller.signal, {
      doneMetadata: () => ({ generationId: 'generation-h1-race' }),
      sideEffects,
      postGeneration,
    })

    expect(result).toEqual({ status: 'aborted', result: 'partial' })
    expect(events).toEqual([{ type: 'token', content: 'partial' }])
    expectNoSuccessDoneAfterAbort(events)
    expect(sideEffects).not.toHaveBeenCalled()
    expect(postGeneration).not.toHaveBeenCalled()
  })

  it('H1: treats non-streaming resultFrames-style silent return as aborted', async () => {
    const controller = new AbortController()
    const events: PromptChatEvent[] = []
    const sideEffects = vi.fn((): PromptChatEvent[] => [])
    const postGeneration = vi.fn(async () => ({ revision: 5 }))

    async function* frames(): AsyncGenerator<CompletionStreamFrame> {
      await Promise.resolve()
      controller.abort()
    }

    const result = await emitProviderChunks(frames(), (event) => events.push(event), controller.signal, {
      doneMetadata: () => ({ generationId: 'generation-h1-resultframes' }),
      sideEffects,
      postGeneration,
    })

    expect(result).toEqual({ status: 'aborted', result: '' })
    expect(events).toEqual([])
    expectNoSuccessDoneAfterAbort(events)
    expect(sideEffects).not.toHaveBeenCalled()
    expect(postGeneration).not.toHaveBeenCalled()
  })
})

describe('per-generation stored asset cache', () => {
  it('caches stored asset reads by normalized asset id and purpose', async () => {
    const assetId = 'a'.repeat(64)
    const reads: string[] = []
    const resolver = createRequestScopedStoredAssetResolver(null as any, '/data', (_db, _dataDir, id, purpose) => {
      reads.push(`${purpose}:${id}`)
      return {
        type: purpose === 'inlay' ? 'audio' : 'image',
        base64: `data:${purpose}:${id}`,
      }
    })

    const first = await resolver(assetId, 'asset_prompt')
    const second = await resolver(`assets/${assetId}.png`, 'asset_prompt')
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    await expect(resolver(assetId, 'inlay')).resolves.toEqual({
      type: 'audio',
      base64: `data:inlay:${assetId}`,
    })
    expect(reads).toEqual([`asset_prompt:${assetId}`, `inlay:${assetId}`])
  })

  it('caches missing assets only for one request-scoped resolver', async () => {
    const assetId = 'b'.repeat(64)
    const reads: string[] = []
    const makeResolver = () =>
      createRequestScopedStoredAssetResolver(null as any, '/data', (_db, _dataDir, id, purpose) => {
        reads.push(`${purpose}:${id}`)
        return undefined
      })

    const firstResolver = makeResolver()
    await expect(firstResolver(assetId, 'asset_prompt')).resolves.toBeUndefined()
    await expect(firstResolver(`assets/${assetId}.webp`, 'asset_prompt')).resolves.toBeUndefined()

    const secondResolver = makeResolver()
    await expect(secondResolver(assetId, 'asset_prompt')).resolves.toBeUndefined()

    expect(reads).toEqual([`asset_prompt:${assetId}`, `asset_prompt:${assetId}`])
  })
})
