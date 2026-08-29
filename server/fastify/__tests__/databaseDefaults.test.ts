import { describe, expect, it } from 'vitest'
import { createInitialDatabase, normalizeDatabaseDefaults } from '../src/databaseDefaults.js'
import { MODEL_ROLES } from '../../../src/ts/model/modelRoles.js'
import { LLMFlags } from '../../../src/ts/model/types.js'
import { DEFAULT_BARDWIKI_GLOBAL_SETTINGS } from '@risuai/protocol'

describe('database defaults', () => {
  it('normalizes prompt roles at top-level, legacy-preset, and modern-preset entry points', () => {
    const database = normalizeDatabaseDefaults(
      {
        promptTemplate: [{ id: 'top', type: 'description', role2: 'assistant' }],
        botPresets: [
          {
            id: 'legacy',
            promptTemplate: [{ id: 'legacy-row', type: 'authornote', role2: 'char' }],
          },
        ],
        promptPresets: [
          {
            id: 'modern',
            name: 'Modern',
            promptTemplate: [{ id: 'modern-row', type: 'cache', role: 'bot' }],
          },
        ],
      },
      { providerDefaults: false },
    )

    expect((database.promptTemplate as Array<Record<string, unknown>>)[0].role2).toBe('bot')
    expect(((database.botPresets as Array<Record<string, unknown>>)[0].promptTemplate as any[])[0].role2).toBe('bot')
    expect(((database.promptPresets as Array<Record<string, unknown>>)[0].promptTemplate as any[])[0].role).toBe(
      'assistant',
    )
  })

  it('keeps a null prompt template null', () => {
    const database = normalizeDatabaseDefaults({ promptTemplate: null }, { providerDefaults: false })
    expect(database.promptTemplate).toBeNull()
  })

  it('creates canonical model roles and script compatibility keys', () => {
    const database = createInitialDatabase()

    expect(Object.keys(database.modelRoles as Record<string, unknown>)).toEqual([...MODEL_ROLES])
    expect(database.modelProfiles).toEqual([])
    expect(database.providerCredentials).toEqual([])
    expect(database.modelRoleProfiles).toEqual(
      Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
    )
    expect(database.modelRuntimeDefaults).toEqual({})
    expect(database.agentPresets).toEqual([])
    expect(database.agentPresetDefaultId).toBeUndefined()
    expect(database.inputHooks).toEqual([
      {
        id: 'default-translate',
        name: 'Translate',
        type: 'draft',
        prompt:
          'Translate the following user message into English. Preserve names, commands, markdown, and inlay tags. Output only the translated message.',
        model: { mode: 'inheritOtherAx' },
      },
    ])
    expect(database.reducedMotion).toBe(false)
    expect(database.floatingChatInput).toBe(true)
    expect(database.chatScreenWidth).toBe(900)
    expect(database.chatLoadInitialPages).toBe(30)
    expect(database.chatLoadAdditionalPages).toBe(15)
    expect(database.autoTranslateNotificationDeferCapSeconds).toBe(180)
    expect(database.paragraphBreakBySentences).toBe(false)
    expect(database.paragraphBreakSentenceCount).toBe(3)
    expect(database.translatorSendTextAsIs).toBe(false)
    expect(database.translatorExcludeThoughts).toBe(false)
    expect(database.reasoningEffort).toBe(0)
    expect(database.verbosity).toBe(1)
    expect(database.bardWiki).toEqual(DEFAULT_BARDWIKI_GLOBAL_SETTINGS)
    expect(database.showSavingIcon).toBe(true)
    expect(database.useMonacoEditorOnDesktop).toBe(false)
    expect(database.useMonacoEditorOnMobile).toBe(false)
    expect(database.applyAdditionalParamsToAll).toBe(false)
    expect(database.openAIFlexProcessing).toBe(false)
    expect(database.customColorScheme).toEqual(database.colorScheme)
    expect(database.customColorScheme).not.toBe(database.colorScheme)
    expect(database.autoTranslate).toBeUndefined()
    expect(database.showGlobalLorebookAndRegex).toBe(false)
    expect(database).not.toHaveProperty('moodLightMembership')
    expect(database.loreBook).toEqual([
      expect.objectContaining({ id: 'default-global-lorebook', name: 'My First LoreBook', data: [] }),
    ])
    expect(database.strictScriptCheck).toBe(false)
    expect(database.complexRegexCompatibilityMode).toBe('worker')
    expect(database.complexRegexInputTimeoutMs).toBe(15000)
    expect(database.complexRegexOutputTimeoutMs).toBe(15000)
    expect(database.complexRegexDisplayTimeoutMs).toBe(15000)
    expect(database.seperateModels).toMatchObject({
      memory: '',
      emotion: '',
      translate: '',
      otherAx: '',
      scriptMain: '',
      scriptAux: '',
    })
    expect(database.fallbackModels).toMatchObject({
      model: [],
      memory: [],
      emotion: [],
      translate: [],
      otherAx: [],
      scriptMain: [],
      scriptAux: [],
    })
    expect(database.seperateParameters).toMatchObject({
      memory: {},
      emotion: {},
      translate: {},
      otherAx: {},
      scriptMain: {},
      scriptAux: {},
      overrides: {},
    })
  })

  it('preserves valid BardWiki defaults and resets malformed imported settings', () => {
    expect(
      normalizeDatabaseDefaults(
        { bardWiki: { ...DEFAULT_BARDWIKI_GLOBAL_SETTINGS, memoryMode: 'hybrid' } },
        { providerDefaults: false },
      ).bardWiki,
    ).toEqual({ ...DEFAULT_BARDWIKI_GLOBAL_SETTINGS, memoryMode: 'hybrid' })
    expect(
      normalizeDatabaseDefaults(
        { bardWiki: { ...DEFAULT_BARDWIKI_GLOBAL_SETTINGS, maxLinkHops: 99 } },
        { providerDefaults: false },
      ).bardWiki,
    ).toEqual(DEFAULT_BARDWIKI_GLOBAL_SETTINGS)
  })

  it('normalizes local character and module script model overrides', () => {
    const database = normalizeDatabaseDefaults(
      {
        characters: [
          { chaId: 'char-a', scriptModelOverrides: { llmProfileId: ' main-profile ' } },
          { chaId: 'char-b', scriptModelOverrides: { llmProfileId: '' } },
        ],
        modules: [
          {
            id: 'module-a',
            name: 'Module A',
            description: '',
            scriptModelOverrides: { axLlmProfileId: ' aux-profile ' },
          },
          { id: 'module-b', name: 'Module B', description: '', scriptModelOverrides: [] },
        ],
      },
      { providerDefaults: false },
    )

    expect((database.characters as Array<Record<string, unknown>>)[0].scriptModelOverrides).toEqual({
      llmProfileId: 'main-profile',
    })
    expect((database.characters as Array<Record<string, unknown>>)[1]).not.toHaveProperty('scriptModelOverrides')
    expect((database.modules as Array<Record<string, unknown>>)[0].scriptModelOverrides).toEqual({
      axLlmProfileId: 'aux-profile',
    })
    expect((database.modules as Array<Record<string, unknown>>)[1]).not.toHaveProperty('scriptModelOverrides')
  })

  it('retires Mood Light classification without removing its characters', () => {
    const database = normalizeDatabaseDefaults(
      {
        characters: [{ chaId: 'char-formerly-protected', name: 'Visible' }],
        characterOrder: ['char-formerly-protected'],
        moodLightMembership: { characterIds: ['char-formerly-protected'], folders: [] },
      },
      { providerDefaults: false },
    )

    expect(database).not.toHaveProperty('moodLightMembership')
    expect(database.characters).toEqual([expect.objectContaining({ chaId: 'char-formerly-protected' })])
    expect(database.characterOrder).toEqual(['char-formerly-protected'])
  })

  it('normalizes configurable chat load counts', () => {
    const database = normalizeDatabaseDefaults(
      {
        chatLoadInitialPages: 12.9,
        chatLoadAdditionalPages: 0,
      },
      { providerDefaults: false },
    )

    expect(database.chatLoadInitialPages).toBe(12)
    expect(database.chatLoadAdditionalPages).toBe(15)
  })

  it('preserves an enabled app reduced-motion preference', () => {
    const database = normalizeDatabaseDefaults({ reducedMotion: true }, { providerDefaults: false })

    expect(database.reducedMotion).toBe(true)
  })

  it('preserves the all-model additional-parameters opt-in', () => {
    const database = normalizeDatabaseDefaults({ applyAdditionalParamsToAll: true }, { providerDefaults: false })

    expect(database.applyAdditionalParamsToAll).toBe(true)
  })

  it('preserves an enabled OpenAI Flex processing preference', () => {
    const database = normalizeDatabaseDefaults({ openAIFlexProcessing: true }, { providerDefaults: false })

    expect(database.openAIFlexProcessing).toBe(true)
  })

  it('preserves legacy custom palettes separately from the active palette', () => {
    const legacyCustom = {
      bgcolor: '#111111',
      darkbg: '#222222',
      borderc: '#333333',
      selected: '#444444',
      draculared: '#555555',
      textcolor: '#eeeeee',
      textcolor2: '#dddddd',
      darkBorderc: '#666666',
      darkbutton: '#777777',
      type: 'dark',
    }
    const database = normalizeDatabaseDefaults(
      { colorSchemeName: 'custom', colorScheme: legacyCustom },
      { providerDefaults: false },
    )

    expect(database.customColorScheme).toEqual(legacyCustom)
    expect(database.customColorScheme).not.toBe(database.colorScheme)
  })

  it('preserves an explicit floating-input opt-out', () => {
    const database = normalizeDatabaseDefaults({ floatingChatInput: false }, { providerDefaults: false })

    expect(database.floatingChatInput).toBe(false)
  })

  it('preserves an explicit saving-icon opt-out', () => {
    const database = normalizeDatabaseDefaults({ showSavingIcon: false }, { providerDefaults: false })

    expect(database.showSavingIcon).toBe(false)
  })

  it('preserves explicit Monaco editor preferences', () => {
    const database = normalizeDatabaseDefaults(
      { useMonacoEditorOnDesktop: true, useMonacoEditorOnMobile: true },
      { providerDefaults: false },
    )

    expect(database.useMonacoEditorOnDesktop).toBe(true)
    expect(database.useMonacoEditorOnMobile).toBe(true)
  })

  it('preserves an existing chat screen width', () => {
    const database = normalizeDatabaseDefaults({ chatScreenWidth: 1240 }, { providerDefaults: false })

    expect(database.chatScreenWidth).toBe(1240)
  })

  it('preserves an existing translation-notification defer cap', () => {
    const database = normalizeDatabaseDefaults(
      { autoTranslateNotificationDeferCapSeconds: 0 },
      { providerDefaults: false },
    )

    expect(database.autoTranslateNotificationDeferCapSeconds).toBe(0)
  })

  it('preserves existing sentence paragraph display preferences', () => {
    const database = normalizeDatabaseDefaults(
      { paragraphBreakBySentences: true, paragraphBreakSentenceCount: 7 },
      { providerDefaults: false },
    )

    expect(database.paragraphBreakBySentences).toBe(true)
    expect(database.paragraphBreakSentenceCount).toBe(7)
  })

  it('preserves an enabled send-text-as-is translation preference', () => {
    const database = normalizeDatabaseDefaults(
      { translatorSendTextAsIs: true, translatorExcludeThoughts: true },
      { providerDefaults: false },
    )

    expect(database.translatorSendTextAsIs).toBe(true)
    expect(database.translatorExcludeThoughts).toBe(true)
  })

  it('normalizes old model maps without dropping script roles', () => {
    const database = normalizeDatabaseDefaults(
      {
        aiModel: 'main-model',
        subModel: 'aux-model',
        modelRoles: {
          chatMain: 'role-main',
          memory: '   ',
          scriptAux: 'role-script-aux',
        },
        seperateModels: {
          otherAx: 'legacy-other-ax',
          scriptAux: 'legacy-script-aux',
        },
        fallbackModels: {
          model: ['main-fallback', ''],
          otherAx: ['other-fallback'],
          scriptAux: ['script-fallback', ''],
        },
        seperateParameters: {
          memory: { temperature: 50 },
          scriptAux: { top_p: 0.7 },
          overrides: { 'model-a': { top_k: 20 } },
        },
        providerCredentials: [
          { id: ' credential-a ', name: ' Primary key ', type: 'apiKey', apiKey: ' profile-secret ' },
        ],
        modelProfiles: [
          {
            id: 'profile-a',
            name: 'Primary',
            modelId: 'gpt-5',
            providerOptions: {
              credentialId: ' credential-a ',
              apiKey: ' profile-secret ',
              openAIKey: 'must-drop',
            },
          },
          { id: 'profile-a', name: 'Duplicate' },
          { id: 'profile-b', name: 'Identity Only', modelId: '' },
          { id: 'profile-c' },
        ],
        modelRoleProfiles: {
          memory: { mode: 'profile', profileId: 'profile-a' },
          translate: { mode: 'legacy' },
        },
        modelRuntimeDefaults: {
          maxContext: 8192,
          temperature: 55,
          modelTools: [' tool-a ', ''],
          customFlags: [LLMFlags.hasImageInput, 999],
          unsupportedRuntimeField: true,
        },
        agentPresets: [
          {
            id: ' ap_research ',
            name: ' Research ',
            enabled: true,
            steps: [{ id: ' aps_context ', outputKey: ' context ' }],
          },
        ],
        agentPresetDefaultId: 'ap_research',
      },
      { providerDefaults: false },
    )

    expect(database.modelRoles).toMatchObject({
      chatMain: 'role-main',
      memory: '',
      scriptAux: 'role-script-aux',
    })
    expect(database.seperateModels).toMatchObject({
      otherAx: 'legacy-other-ax',
      scriptMain: '',
      scriptAux: 'legacy-script-aux',
    })
    expect(database.fallbackModels).toMatchObject({
      model: ['main-fallback'],
      otherAx: ['other-fallback'],
      scriptMain: [],
      scriptAux: ['script-fallback'],
    })
    expect(database.seperateParameters).toMatchObject({
      memory: { temperature: 50 },
      scriptMain: {},
      scriptAux: { top_p: 0.7 },
      overrides: { 'model-a': { top_k: 20 } },
    })
    expect(database.providerCredentials).toEqual([
      { id: 'credential-a', name: 'Primary key', type: 'apiKey', apiKey: 'profile-secret' },
    ])
    expect(database.modelProfiles).toEqual([
      { id: 'profile-a', name: 'Primary', modelId: 'gpt-5', providerOptions: { credentialId: 'credential-a' } },
      { id: 'profile-b', name: 'Identity Only' },
      { id: 'profile-c', name: 'profile-c' },
    ])
    expect(database.modelRoleProfiles).toEqual({
      ...Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
      memory: { mode: 'profile', profileId: 'profile-a' },
    })
    expect(database.modelRuntimeDefaults).toEqual({
      maxContext: 8192,
      temperature: 55,
      modelTools: ['tool-a'],
      customFlags: [LLMFlags.hasImageInput],
    })
    expect(database.agents).toEqual([
      {
        id: 'aps_context',
        name: 'aps_context',
        version: 1,
        instruction: '',
        modelDefaults: { mode: 'inheritMain' },
        runtimeDefaults: {},
        inputScopes: [],
        outputFormat: 'text',
      },
    ])
    expect(database.agentPresets).toEqual([
      {
        id: 'ap_research',
        name: 'Research',
        enabled: true,
        version: 1,
        agentUses: [
          {
            id: 'aps_context',
            agentId: 'aps_context',
            enabled: true,
            phase: 'beforeMain',
            dependencies: [],
            outputKey: 'context',
            destination: 'promptOutput',
            failurePolicy: { mode: 'required' },
          },
        ],
        steps: [],
      },
    ])
    expect(database.agentPresetDefaultId).toBe('ap_research')
  })

  it('clears missing Agent Preset defaults during normalization', () => {
    const database = normalizeDatabaseDefaults(
      {
        agentPresets: [{ id: 'ap_existing', name: 'Existing' }],
        agentPresetDefaultId: 'ap_missing',
      },
      { providerDefaults: false },
    )

    expect(database.agentPresets).toEqual([
      {
        id: 'ap_existing',
        name: 'Existing',
        enabled: true,
        version: 1,
        agentUses: [],
        steps: [],
      },
    ])
    expect(database.agents).toEqual([])
    expect(database.agentPresetDefaultId).toBeUndefined()
  })

  it('falls back retired PIP session keepalive to sound', () => {
    const database = normalizeDatabaseDefaults(
      {
        keepSessionAlive: 'pip',
      },
      { providerDefaults: false },
    )

    expect(database.keepSessionAlive).toBe('sound')
  })

  it('normalizes Persona links to unique existing non-MCP modules', () => {
    const database = normalizeDatabaseDefaults(
      {
        modules: [
          { id: 'module-a', name: 'A', description: '' },
          { id: 'mcp-a', name: 'MCP', description: '', mcp: { url: 'internal:risuai' } },
        ],
        personas: [
          {
            id: 'persona-a',
            name: 'Persona',
            icon: '',
            personaPrompt: '',
            modules: ['module-a', 'module-a', 'missing', 'mcp-a'],
          },
        ],
      },
      { providerDefaults: false },
    )

    expect((database.personas as Array<{ modules?: string[] }>)[0].modules).toEqual(['module-a'])
  })

  it('removes retired hotkey rows while preserving supported custom bindings', () => {
    const database = normalizeDatabaseDefaults(
      {
        hotkeys: [
          { action: 'home', ctrl: true, key: 'j' },
          { action: 'modelSelect', ctrl: true, key: 'm' },
          { action: 'toggleVoice', ctrl: true, key: 'v' },
          { action: 'webcam', ctrl: true, key: 'w' },
          { action: 'popupEditor', ctrl: true, key: 'e' },
        ],
      },
      { providerDefaults: false },
    )

    const hotkeys = database.hotkeys as Array<Record<string, unknown>>
    expect(hotkeys.map((hotkey) => hotkey.action)).not.toEqual(
      expect.arrayContaining(['modelSelect', 'toggleVoice', 'webcam']),
    )
    expect(hotkeys.find((hotkey) => hotkey.action === 'home')).toMatchObject({ ctrl: true, key: 'j' })
    expect(hotkeys.find((hotkey) => hotkey.action === 'popupEditor')).toMatchObject({ ctrl: true, key: 'e' })
  })
})
