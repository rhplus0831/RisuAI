import { describe, expect, it } from 'vitest'
import { extractConfiguredJsonValue, parseConfiguredJsonSchemaText } from '../src/generation/jsonControls.js'

describe('parseConfiguredJsonSchemaText', () => {
  it('accepts the TypeScript-interface syntax exposed by the schema editor', () => {
    expect(
      parseConfiguredJsonSchemaText(`
        export interface Reply {
          answer: string
          score?: number
          tags: string[]
          mood: 'happy' | "calm"
        }
      `),
    ).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      properties: {
        answer: { type: 'string' },
        score: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
        mood: { type: 'string', enum: ['happy', 'calm'] },
      },
      required: ['answer', 'tags', 'mood'],
    })
  })

  it('continues accepting JSON schema objects', () => {
    expect(parseConfiguredJsonSchemaText('{"type":"object","properties":{}}')).toEqual({
      type: 'object',
      properties: {},
    })
  })
})

describe('extractConfiguredJsonValue', () => {
  it('extracts a configured dot path from fenced output after reasoning', () => {
    expect(
      extractConfiguredJsonValue(
        '<Thoughts>private</Thoughts>\n```json\n{"reply":{"text":"visible"}}\n```',
        'reply.text',
      ),
    ).toBe('visible')
  })

  it('leaves non-JSON provider output unchanged', () => {
    expect(extractConfiguredJsonValue('plain response', 'reply.text')).toBe('plain response')
  })
})
