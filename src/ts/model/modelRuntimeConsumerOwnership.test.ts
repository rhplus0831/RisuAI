import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Database } from '../storage/database.svelte'
import { LLMFormat, LLMProvider, LLMTokenizer, OpenAIParameters, type LLMModel } from './types'
import { resolveModelProfile } from './modelProfileResolver'

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

  it('routes translation cache and locale identity through the resolved translate role', () => {
    const translator = source('src/ts/translator/translator.ts')

    expect(translator).not.toContain('db.aiModel')
    expect(translator).toContain("resolveModelProfile({ database: db, role: 'translate' })")
    expect(translator).toContain('isNovelListModelProfile(profile)')
    expect(translator).toContain('translateSourceLanguage: getTranslateSourceLanguage(db)')
  })

  it('routes settings metadata through the resolved model context', () => {
    const parameters = source('src/ts/setting/botSettingsParamsData.ts')

    expect(parameters).not.toContain('ctx.db.aiModel')
    expect(parameters).toContain('ctx.modelInfo.id')
  })

  it('routes BotSettings metadata through durable chat profiles over conflicting flat models', () => {
    const database = {
      aiModel: 'flat-main-model',
      subModel: 'flat-aux-model',
      modelRoles: {},
      modelProfiles: [
        { id: 'main-profile', name: 'Main', providerId: 'openai', modelId: 'durable-main-model' },
        { id: 'aux-profile', name: 'Aux', providerId: 'anthropic', modelId: 'durable-aux-model' },
      ],
      modelRoleProfiles: {
        chatMain: { mode: 'profile', profileId: 'main-profile' },
        chatAux: { mode: 'profile', profileId: 'aux-profile' },
      },
    } as unknown as Database
    const lookupModelInfo = (_database: Database, id: string): LLMModel => ({
      id,
      name: id,
      provider: id === 'durable-main-model' ? LLMProvider.OpenAI : LLMProvider.Anthropic,
      format: id === 'durable-main-model' ? LLMFormat.OpenAICompatible : LLMFormat.Anthropic,
      flags: [],
      parameters: OpenAIParameters,
      tokenizer: LLMTokenizer.Unknown,
    })

    const mainProfile = resolveModelProfile({ database, role: 'chatMain', lookupModelInfo })
    const auxProfile = resolveModelProfile({ database, role: 'chatAux', lookupModelInfo })
    expect(mainProfile).toMatchObject({ modelId: 'durable-main-model', source: { kind: 'durable-profile' } })
    expect(auxProfile).toMatchObject({ modelId: 'durable-aux-model', source: { kind: 'durable-profile' } })
    expect(mainProfile.modelInfo.format).toBe(LLMFormat.OpenAICompatible)
    expect(auxProfile.modelInfo.format).toBe(LLMFormat.Anthropic)

    const botSettings = source('src/lib/Setting/Pages/BotSettings.svelte')
    expect(botSettings).toContain("role: 'chatMain'")
    expect(botSettings).toContain("role: 'chatAux'")
    expect(botSettings).toContain('let modelInfo = $derived(mainProfile.modelInfo)')
    expect(botSettings).toContain('let subModelInfo = $derived(auxProfile.modelInfo)')
    expect(botSettings).not.toContain('getModelInfo(getDatabase().aiModel)')
    expect(botSettings).not.toContain('getModelInfo(getDatabase().subModel)')
    expect(botSettings).not.toContain('getDatabase().aiModel ===')
  })

  it('budgets low-level lore loading through the scriptMain profile', () => {
    const scriptings = source('src/ts/process/scriptings.ts')

    expect(scriptings).toContain("resolveModelProfile({ database: db, role: 'scriptMain' })")
    expect(scriptings).not.toContain('const maxContext = db.maxContext - reserve')
  })

  it('routes HypaV3 response reservation through the resolved chat profile', () => {
    const hypaV3 = source('src/ts/process/memory/hypav3.ts')
    const otherBotSettings = source('src/lib/Setting/Pages/OtherBotSettings.svelte')

    expect(hypaV3).not.toContain('currentTokens -= db.maxResponse')
    expect(hypaV3.match(/currentTokens -= resolveHypaV3ResponseTokenReservation\(db\)/g)).toHaveLength(2)
    expect(hypaV3).toContain("resolveModelProfile({ database, role: 'chatMain' })")
    expect(otherBotSettings).toContain("resolveModelProfile({ database, role: 'chatMain' })")
    expect(otherBotSettings).toContain('mainProfile.runtimeOptions.maxResponse')
    expect(otherBotSettings).toContain('mainProfile.runtimeOptions.maxContext')
  })

  it('routes Fastify trigger model context through the resolved chat profile', () => {
    const triggers = source('server/fastify/src/prompt/triggers.ts')

    expect(triggers).not.toContain('model: db.aiModel')
    expect(triggers).toContain("resolvePromptModelId(db, 'chatMain')")
    expect(triggers).toContain('model,')
  })
})
