import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { SERVER_SETTINGS_KEYS_BY_GROUP } from '../../../src/ts/server/settingsGroups.js'
import { READABLE_SETTINGS_GROUPS, SETTINGS_GROUP_KEYS, SETTINGS_GROUPS } from '../src/routes/commands.js'
import { SERVER_RAW_TRANSLATOR_TYPES } from '../src/translation/serverAutoTranslationEligibility.js'

describe('settings group parity', () => {
  it('assigns every generically writable setting to exactly one canonical group', () => {
    const owners = new Map<string, string[]>()
    for (const group of SETTINGS_GROUPS) {
      const keys = SETTINGS_GROUP_KEYS[group]
      expect(new Set(keys).size, `${group} contains duplicate keys`).toBe(keys.length)
      for (const key of keys) {
        owners.set(key, [...(owners.get(key) ?? []), group])
      }
    }

    expect(
      [...owners.entries()].filter(([, groups]) => groups.length > 1),
      "writable settings must not advance a different group's revision fence",
    ).toEqual([])
  })

  it('keeps the dedicated Agent Preset projection readable but not generically writable', () => {
    expect(READABLE_SETTINGS_GROUPS).toContain('agents')
    expect(SETTINGS_GROUPS).not.toContain('agents')
    expect(SETTINGS_GROUP_KEYS.agents).toEqual(['agentPresets', 'agentPresetDefaultId'])
    const clientGroups = SERVER_SETTINGS_KEYS_BY_GROUP as Record<string, string[]>
    expect(clientGroups.agents).toEqual([...SETTINGS_GROUP_KEYS.agents])
  })

  it('keeps the model profile projection exact, read-only, and provider-write compatible', () => {
    const modelProfileSettingsKeys = ['modelProfiles', 'modelRoleProfiles', 'modelRuntimeDefaults']
    expect(READABLE_SETTINGS_GROUPS).toContain('models')
    expect(SETTINGS_GROUPS).not.toContain('models')
    expect(SETTINGS_GROUP_KEYS.models).toEqual(modelProfileSettingsKeys)
    const clientGroups = SERVER_SETTINGS_KEYS_BY_GROUP as Record<string, string[]>
    expect(clientGroups.models).toEqual(modelProfileSettingsKeys)

    for (const key of modelProfileSettingsKeys) {
      expect(SETTINGS_GROUP_KEYS.providers).toContain(key)
      expect(clientGroups.providers).toContain(key)
    }
  })

  it('keeps Input Hooks in the advanced settings projection', () => {
    expect(SETTINGS_GROUP_KEYS.advanced).toContain('inputHooks')
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.advanced).toContain('inputHooks')
  })

  it('keeps chat screen width in the display settings projection', () => {
    expect(SETTINGS_GROUP_KEYS.display).toContain('chatScreenWidth')
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.display).toContain('chatScreenWidth')
  })

  it('keeps the translation-notification defer cap in the display settings projection', () => {
    expect(SETTINGS_GROUP_KEYS.display).toContain('autoTranslateNotificationDeferCapSeconds')
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.display).toContain('autoTranslateNotificationDeferCapSeconds')
  })

  it('keeps sentence paragraph preferences in the display settings projection', () => {
    for (const key of ['paragraphBreakBySentences', 'paragraphBreakSentenceCount']) {
      expect(SETTINGS_GROUP_KEYS.display).toContain(key)
      expect(SERVER_SETTINGS_KEYS_BY_GROUP.display).toContain(key)
    }
  })

  it('documents server automatic-translation parity with the Chat.svelte guards', () => {
    const chatSource = readFileSync(path.join(process.cwd(), 'src/lib/ChatScreens/Chat.svelte'), 'utf8')

    expect(chatSource).toContain('chat?.autoTranslate === true')
    expect(chatSource).toContain('message.trim().length === 0')
    expect(chatSource).toContain("getDatabase().translator !== ''")
    for (const translatorType of SERVER_RAW_TRANSLATOR_TYPES) {
      expect(chatSource).toContain(`getDatabase().translatorType === '${translatorType}'`)
    }
    expect(chatSource).toContain("getDatabase().autoTranslateCachedOnly && getDatabase().translatorType === 'llm'")
  })

  it('does not accept the retired Claude batching setting', () => {
    expect(SETTINGS_GROUP_KEYS.providers).not.toContain('claudeBatching')
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.providers).not.toContain('claudeBatching')
  })

  it('does not accept the retired Claude cache-retrieval setting', () => {
    expect(SETTINGS_GROUP_KEYS.providers).not.toContain('claudeRetrivalCaching')
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.providers).not.toContain('claudeRetrivalCaching')
  })

  it('does not accept the retired force-proxy-format setting', () => {
    expect(SETTINGS_GROUP_KEYS.advanced).not.toContain('forceProxyAsOpenAI')
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.advanced).not.toContain('forceProxyAsOpenAI')
  })

  it('does not accept the retired Hypa punctuation setting', () => {
    expect(SETTINGS_GROUP_KEYS.memory).not.toContain('removePunctuationHypa')
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.memory).not.toContain('removePunctuationHypa')
  })

  it('does not accept the retired overload retry setting', () => {
    expect(SETTINGS_GROUP_KEYS.runtime).not.toContain('antiServerOverloads')
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.runtime).not.toContain('antiServerOverloads')
  })

  it('does not accept the retired local-network routing settings', () => {
    expect(SETTINGS_GROUP_KEYS.runtime).not.toContain('localNetworkMode')
    expect(SETTINGS_GROUP_KEYS.runtime).not.toContain('localNetworkTimeoutSec')
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.runtime).not.toContain('localNetworkMode')
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.runtime).not.toContain('localNetworkTimeoutSec')
  })

  it('does not accept the retired Google Cloud tokenizer setting', () => {
    expect(SETTINGS_GROUP_KEYS.runtime).not.toContain('googleClaudeTokenizing')
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.runtime).not.toContain('googleClaudeTokenizing')
  })

  it('does not expose the retired global auto-translate setting', () => {
    expect(SETTINGS_GROUP_KEYS.language).not.toContain('autoTranslate')
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.language).not.toContain('autoTranslate')
  })
})
