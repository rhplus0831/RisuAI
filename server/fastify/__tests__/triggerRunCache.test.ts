import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  createTriggerRunCache,
  getRecentTranscriptLower,
  getRecentTranscriptRaw,
  getRecentTranscriptStrictWords,
  invalidateTriggerTranscriptCache,
  type TriggerTranscriptChat,
} from '../src/prompt/triggerRunCache.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

describe('trigger run cache', () => {
  it('reuses message-array identity until explicit invalidation', () => {
    const cache = createTriggerRunCache()
    const chat: TriggerTranscriptChat = {
      message: [{ data: 'Alpha beta' }, { data: 'Needle' }],
    }
    const slice = vi.spyOn(chat.message, 'slice')

    expect(getRecentTranscriptRaw(cache, chat, 2)).toBe('Alpha beta Needle')
    expect(getRecentTranscriptLower(cache, chat, 2)).toBe('alpha beta needle')
    expect(getRecentTranscriptStrictWords(cache, chat, 2)).toEqual(new Set(['Alpha', 'beta', 'Needle']))
    expect(slice).toHaveBeenCalledOnce()

    chat.message[1].data = 'Changed'
    expect(getRecentTranscriptRaw(cache, chat, 2)).toBe('Alpha beta Needle')

    invalidateTriggerTranscriptCache(cache)
    expect(getRecentTranscriptRaw(cache, chat, 2)).toBe('Alpha beta Changed')
    expect(slice).toHaveBeenCalledTimes(2)
  })

  it('owns its transcript inputs in Fastify', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'server/fastify/src/prompt/triggerRunCache.ts'), 'utf8')

    expect(source).not.toContain('src/ts/storage/database.svelte')
    expect(source).toContain('export interface TriggerTranscriptChat')
    expect(source).toContain('WeakMap<TriggerTranscriptMessage[]')
  })
})
