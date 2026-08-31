import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  aggregate: {
    jsonSchema: '{"type":"string"}',
    strictJsonSchema: false,
  },
  settings: {
    value: {} as Record<string, unknown>,
    status: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
    groupStatuses: { prompt: 'ready' } as Record<string, 'idle' | 'loading' | 'ready' | 'error'>,
  },
}))

vi.mock('src/ts/parser/parser.svelte', () => ({ risuChatParser: (value: string) => value }))
vi.mock('src/ts/server/resourceState.svelte', () => ({ settingsResourceState: state.settings }))
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => state.aggregate }))
vi.mock('src/ts/util', () => ({ jsonOutputTrimmer: (value: string) => value }))

import { getGeneralJSONSchema, getOpenAIJSONSchema } from './jsonSchema'

beforeEach(() => {
  state.settings.value = {
    jsonSchema: '{"type":"number"}',
    strictJsonSchema: true,
  }
  state.settings.status = 'ready'
  state.settings.groupStatuses.prompt = 'ready'
})

describe('JSON schema settings owner', () => {
  it('uses the ready prompt-settings owner instead of the aggregate', () => {
    expect(getOpenAIJSONSchema()).toEqual({
      name: 'format',
      strict: true,
      schema: { type: 'number' },
    })
  })

  it('accepts explicit schema input while the settings owner is unavailable', () => {
    state.settings.groupStatuses.prompt = 'error'

    expect(getGeneralJSONSchema('{"type":"boolean"}')).toEqual({ type: 'boolean' })
  })

  it('fails closed instead of reading the aggregate schema after an owner error', () => {
    state.settings.groupStatuses.prompt = 'error'

    expect(() => getOpenAIJSONSchema()).toThrow('JSON schema is unavailable')
  })
})
