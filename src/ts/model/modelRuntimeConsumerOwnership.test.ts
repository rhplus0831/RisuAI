import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('browser model-runtime consumer ownership', () => {
  it('keeps tokenizer budgeting off the flat main-model field', () => {
    const tokenizer = source('src/ts/tokenizer.ts')
    const sendContext = source('src/ts/process/sendChatContext.ts')

    expect(tokenizer).not.toContain('getDatabase().aiModel')
    expect(sendContext).not.toContain('getDatabase().aiModel')
    expect(tokenizer).toContain("role: 'chatMain'")
    expect(tokenizer).toContain('encode(data.content, this.profile, this.tokenizerSelection)')
    expect(sendContext).toContain('resolveMainTokenizerProfile(database)')
    expect(sendContext).toContain('mainProfile.runtimeOptions.maxContext')
  })

  it('shares durable tokenizer-selection precedence with Fastify', () => {
    const sharedResolver = source('src/ts/model/modelProfileResolver.ts')
    const tokenizer = source('src/ts/tokenizer.ts')
    const serverConfig = source('server/fastify/src/prompt/effectiveGenerationConfig.ts')
    const helper = 'resolveModelProfileTokenizerSelection'

    expect(sharedResolver).toContain(`export function ${helper}`)
    expect(tokenizer).toContain(helper)
    expect(serverConfig).toContain(helper)
  })

  it('routes prompt-visible model identity through resolved role contexts', () => {
    const cbs = source('src/ts/cbs.ts')
    const browserParser = source('src/ts/parser/parser.svelte.ts')
    const serverAdapter = source('server/fastify/src/prompt/cbsAdapter.ts')
    const pluginApi = source('src/ts/plugins/apiV3/v3.svelte.ts')
    const modelString = source('src/ts/process/models/modelString.ts')

    expect(cbs).not.toContain('return db.aiModel')
    expect(cbs).not.toContain('return db.subModel')
    expect(cbs).toContain("getEffectiveModelContext('chatMain')")
    expect(cbs).toContain("getEffectiveModelContext('chatAux')")
    expect(browserParser).toContain('getModelContext: (role) =>')
    expect(browserParser).toContain('resolveModelProfile({ database: getDatabase(), role })')
    expect(serverAdapter).toContain('getModelContext: getActiveModelContext')
    expect(pluginApi).not.toContain('getModelInfo(getDatabase().aiModel)')
    expect(pluginApi).toContain('resolveModelProfile({ database: getDatabase() }).modelInfo.id')
    expect(modelString).toContain('resolveModelProfile({ database: db })')
    expect(modelString).toContain("profile.source.kind === 'durable-profile'")
  })
})
