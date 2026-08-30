import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('browser prompt-assembly model ownership', () => {
  it('keeps prompt-shape consumers off the flat main-model field', () => {
    for (const consumer of [
      'src/ts/process/promptAssembly/buildHistoryWindow.ts',
      'src/ts/process/promptAssembly/formatHistoryMessage.ts',
      'src/ts/process/promptAssembly/renderFinalPrompt.ts',
    ]) {
      expect(source(consumer), consumer).not.toContain('getDatabase().aiModel')
    }
  })

  it('resolves the main profile once and passes canonical model and response-budget values', () => {
    const assembly = source('src/ts/process/sendChatPromptAssembly.ts')
    expect(assembly).toContain("resolveModelProfile({ database: getDatabase(), role: 'chatMain' })")
    expect(assembly).toContain('const mainModelId = mainProfile.modelId')
    expect(assembly).toContain('const maxResponseTokens = mainProfile.runtimeOptions.maxResponse')
    expect(assembly.match(/modelId: mainModelId/g)).toHaveLength(2)
    expect(assembly.match(/maxResponseTokens/g)).toHaveLength(3)
    expect(assembly).not.toContain('getDatabase().maxResponse + 50')
  })
})
