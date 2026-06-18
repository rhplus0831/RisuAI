import { describe, expect, it } from 'vitest'
import type { Database } from '../../../src/ts/storage/database.svelte'
import { resolveMemorySummaryModel } from '../src/memorySummaryModel.js'

function database(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'gpt4o',
    subModel: 'gpt4om',
    openAIKey: 'sk-test',
    modelRoles: {},
    seperateModelsForAxModels: false,
    seperateModels: {},
    ...overrides,
  } as unknown as Database
}

describe('resolveMemorySummaryModel', () => {
  it('uses the memory role resolver while accepting legacy subModel requests', () => {
    const result = resolveMemorySummaryModel(
      database({
        modelRoles: { memory: 'gpt41-mini' } as Database['modelRoles'],
      }),
      'subModel',
    )

    expect(result).toMatchObject({
      ok: true,
      request: {
        provider: 'openai',
        model: 'gpt41-mini',
      },
    })
  })

  it('accepts the canonical memory request role', () => {
    const result = resolveMemorySummaryModel(
      database({
        seperateModelsForAxModels: true,
        seperateModels: { memory: 'gpt41-nano' } as Database['seperateModels'],
      }),
      'memory',
    )

    expect(result).toMatchObject({
      ok: true,
      request: {
        provider: 'openai',
        model: 'gpt41-nano',
      },
    })
  })
})
