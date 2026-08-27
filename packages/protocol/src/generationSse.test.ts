import { describe, expect, it } from 'vitest'
import {
  PROMPT_CHAT_EVENT_TYPES,
  isPromptChatEvent,
  parsePromptChatSseEvent,
  type PromptChatEvent,
  type PromptChatEventType,
} from '@risuai/protocol/generation-sse'

const emptyPatch = {
  chatId: 'chat-1',
  characterId: 'character-1',
  selectedCharID: 0,
  chatPage: 0,
  varChanged: false,
  messageMutations: [],
  chatVarMutations: [],
  additionalSystemPrompt: [],
} as const

const fixtures = {
  stage: { type: 'stage', stage: 'validate', status: 'start' },
  job_accepted: { type: 'job_accepted', jobId: 'job-1' },
  prompt: { type: 'prompt', messages: [{ role: 'user', content: 'hello' }] },
  info: { type: 'info', generationId: 'generation-1' },
  token: { type: 'token', content: 'partial' },
  replay_gap: {
    type: 'replay_gap',
    reason: 'replay_budget_exceeded',
    jobId: 'job-1',
    evictedEvents: 2,
    evictedBytes: 128,
  },
  message_patch: { type: 'message_patch', patch: emptyPatch },
  side_effect: { type: 'side_effect', kind: 'tts', payload: { text: 'hello' } },
  agent_preset_progress: {
    type: 'agent_preset_progress',
    chatId: 'chat-1',
    presetId: 'preset-1',
    presetName: 'Preset',
    phase: 'beforeMain',
    status: 'running',
    totalSteps: 2,
    completedSteps: 1,
    activeSteps: [{ stepId: 'step-2', stepName: 'Second', outputKey: 'result' }],
  },
  post_generation_progress: {
    type: 'post_generation_progress',
    phase: 'editOutput',
    status: 'running',
    runSeq: 1,
    llmCallCount: 1,
    pendingLlmCount: 0,
    llmCallCounts: { LLM: 1, axLLM: 0 },
    pendingLlmCounts: { LLM: 0, axLLM: 0 },
  },
  warning: { type: 'warning', message: 'Compatibility fallback used' },
  error: { type: 'error', error: 'Provider failed', code: 'provider_failed' },
  done: { type: 'done', outcome: 'completed', result: 'complete' },
} satisfies Record<PromptChatEventType, PromptChatEvent>

describe('generation SSE protocol', () => {
  it('keeps the exported taxonomy exhaustive and validates every event variant', () => {
    expect(Object.keys(fixtures)).toEqual(PROMPT_CHAT_EVENT_TYPES)
    for (const event of Object.values(fixtures)) {
      expect(isPromptChatEvent(event), event.type).toBe(true)
    }
  })

  it('accepts additive fields and optional operation lineage', () => {
    expect(
      isPromptChatEvent({
        ...fixtures.token,
        futureField: { enabled: true },
        databaseLineage: 'lineage-1',
        operationId: 'operation-1',
        writerSessionId: 'writer-1',
        writerEpoch: 2,
        operationStateVersion: 3,
        projectionEpoch: 4,
        attemptNo: 1,
        jobId: 'job-1',
      }),
    ).toBe(true)
  })

  it('rejects unknown events, malformed required fields, and malformed lineage', () => {
    expect(isPromptChatEvent({ type: 'future_event', payload: true })).toBe(false)
    expect(isPromptChatEvent({ type: 'token', content: 42 })).toBe(false)
    expect(isPromptChatEvent({ ...fixtures.token, attemptNo: '1' })).toBe(false)
    expect(
      isPromptChatEvent({
        type: 'message_patch',
        patch: { ...emptyPatch, additionalSystemPrompt: undefined },
      }),
    ).toBe(false)
  })

  it('uses the named SSE event as the discriminator and validates decoded data', () => {
    expect(parsePromptChatSseEvent('token', { content: 'hello', type: 'done' })).toEqual({
      type: 'token',
      content: 'hello',
    })
    expect(parsePromptChatSseEvent('token', { content: 42 })).toBeNull()
    expect(parsePromptChatSseEvent('token', [])).toBeNull()
    expect(parsePromptChatSseEvent('unknown', {})).toBeNull()
  })

  it('accepts legacy nullable message names emitted by persisted transcripts', () => {
    expect(
      isPromptChatEvent({
        type: 'message_patch',
        patch: {
          ...emptyPatch,
          messageMutations: [
            {
              type: 'append',
              source: 'user_message',
              index: 0,
              message: { role: 'user', data: 'hello', name: null },
            },
          ],
        },
      }),
    ).toBe(true)
  })
})
