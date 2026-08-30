import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')

function source(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8')
}

describe('browser request parameter ownership', () => {
  it('threads resolved runtime options into every production parameter builder call', () => {
    const consumers = [
      'src/ts/process/request/anthropic.ts',
      'src/ts/process/request/google.ts',
      'src/ts/process/request/openAI/requests.ts',
      'src/ts/process/request/request.ts',
    ]

    for (const consumer of consumers) {
      const contents = source(consumer)
      const calls = contents.match(/applyParameters\(/gu) ?? []
      const profileInputs = contents.match(/runtimeOptions: arg\.resolvedProfile\?\.runtimeOptions/gu) ?? []
      expect(profileInputs, consumer).toHaveLength(calls.length)
    }
  })

  it('keeps provider-specific sampler overrides behind resolved runtime inputs', () => {
    const anthropic = source('src/ts/process/request/anthropic.ts')
    const openai = source('src/ts/process/request/openAI/requests.ts')
    const request = source('src/ts/process/request/request.ts')

    expect(anthropic).toContain('const thinkingType = hasResolvedProfile')
    expect(anthropic).not.toContain('if (db.thinkingType ===')
    expect(openai).toContain('const deepseekThinkingType = hasResolvedProfile')
    expect(openai).not.toContain('if (db.deepseekThinkingType ===')
    expect(request).toContain('temperature: arg.resolvedProfile')
    expect(request).toContain('arg.resolvedProfile.runtimeOptions.presencePenalty!')
    expect(request).toContain('arg.resolvedProfile.runtimeOptions.frequencyPenalty!')
  })
})
