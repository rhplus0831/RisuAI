import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import {
  beginRequestHistory,
  completeRequestHistory,
  createRequestHistoryTable,
  getRequestHistoryRecord,
  listRequestHistory,
  pruneRequestHistory,
  requestHistoryProfileSnapshot,
  wrapRequestHistoryFrames,
  type RequestHistoryProfileSnapshot,
} from '../src/requestHistory.js'
import type { CompletionStreamFrame } from '../src/generation/frames.js'
import type { ResolvedModelProfile } from '../../../src/ts/model/modelProfileResolver.js'

const profile: RequestHistoryProfileSnapshot = {
  id: 'profile-a',
  name: 'Profile A',
  role: 'chatMain',
  sourceKind: 'durable-profile',
  provider: 'openai',
  modelId: 'gpt-4o',
  requestModel: 'gpt-4o-2024-11-20',
}

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  createRequestHistoryTable(db)
})

afterEach(() => {
  db.close()
})

describe('request history repository', () => {
  it('retains the newest configured records and stores response metadata separately', () => {
    for (let index = 1; index <= 3; index += 1) {
      const handle = beginRequestHistory({
        db,
        limit: 2,
        id: `record-${index}`,
        startedAt: index,
        source: 'chat',
        profile,
        prompt: [{ role: 'user', content: `prompt-${index}` }],
        context: { characterId: 'char-a', chatId: 'chat-a' },
        toggles: { mode: index === 3 ? '1' : '0' },
        metadata: { attempt: index },
      })
      completeRequestHistory(handle, {
        status: 'success',
        response: `response-${index}`,
        metadata: { finishReason: 'stop' },
        completedAt: index + 10,
      })
    }

    expect(listRequestHistory(db, 2).map((record) => record.id)).toEqual(['record-3', 'record-2'])
    const record = getRequestHistoryRecord(db, 'record-3')
    expect(record).toMatchObject({
      status: 'success',
      response: 'response-3',
      toggles: { mode: '1' },
      metadata: { attempt: 3, finishReason: 'stop', durationMs: 10 },
    })
    expect(record?.metadata).not.toHaveProperty('response')
  })

  it('uses zero as disable-and-clear', () => {
    beginRequestHistory({
      db,
      limit: 1,
      source: 'completion',
      profile,
      prompt: [],
    })
    expect(listRequestHistory(db, 1)).toHaveLength(1)
    expect(pruneRequestHistory(db, 0)).toBe(1)
    expect(listRequestHistory(db, 0)).toEqual([])
    expect(beginRequestHistory({ db, limit: 0, source: 'completion', profile, prompt: [] })).toBeNull()
  })

  it('accumulates streaming tokens and terminal frame metadata', async () => {
    const handle = beginRequestHistory({
      db,
      limit: 5,
      id: 'streamed',
      startedAt: 100,
      source: 'chat',
      profile,
      prompt: [{ role: 'user', content: 'hello' }],
    })
    async function* frames(): AsyncGenerator<CompletionStreamFrame> {
      yield { kind: 'token', content: 'hello ' }
      yield { kind: 'token', content: 'world' }
      yield { kind: 'done', finishReason: 'length', alternates: ['alternate'] }
    }

    const received: CompletionStreamFrame[] = []
    for await (const frame of wrapRequestHistoryFrames(frames(), handle, new AbortController().signal)) {
      received.push(frame)
    }

    expect(received).toHaveLength(3)
    expect(getRequestHistoryRecord(db, 'streamed')).toMatchObject({
      status: 'success',
      response: 'hello world',
      metadata: {
        finishReason: 'length',
        alternates: ['alternate'],
        responseCharacters: 11,
      },
    })
  })

  it('builds a credential-free resolved-profile snapshot', () => {
    const resolved = {
      role: 'chatMain',
      profileId: 'profile-secret',
      modelId: 'model-a',
      requestModel: 'wire-a',
      source: { kind: 'durable-profile', profileName: 'Safe name' },
      status: { providerId: 'openai' },
      providerCapability: { routable: true, provider: 'openai' },
      providerOptions: { apiKey: 'must-not-be-stored', requestModel: 'wire-a' },
    } as unknown as ResolvedModelProfile

    const snapshot = requestHistoryProfileSnapshot(resolved)
    expect(snapshot).toEqual({
      id: 'profile-secret',
      name: 'Safe name',
      role: 'chatMain',
      sourceKind: 'durable-profile',
      provider: 'openai',
      modelId: 'model-a',
      requestModel: 'wire-a',
    })
    expect(JSON.stringify(snapshot)).not.toContain('must-not-be-stored')
  })
})
