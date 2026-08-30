import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('legacy OpenAI model-alias shared-core ownership', () => {
  it('keeps every production consumer on the shared leaf', () => {
    const consumers = [
      'server/fastify/src/generation/openai.ts',
      'server/fastify/src/generation/openaiLegacyInstruct.ts',
      'server/fastify/src/generation/openaiResponses.ts',
      'src/ts/process/request/openAI/requests.ts',
    ]

    for (const consumer of consumers) {
      expect(source(consumer), consumer).toContain("from '@risuai/shared-core/legacy-openai-model-aliases'")
    }
    expect(fs.existsSync(new URL('src/ts/model/legacyOpenAIModelAliases.ts', `file://${repoRoot}/`))).toBe(false)
  })
})
