import { describe, expect, it } from 'vitest'
import * as browserSettings from '../../../src/ts/chatGenerationSettings'
import * as sharedSettings from './chatGenerationSettings.js'

describe('chat-generation-settings browser compatibility', () => {
  it('re-exports shared constants and behavior by identity', () => {
    for (const key of [
      'CHAT_GENERATION_SETTINGS_FIELD',
      'CHAT_GENERATION_SETTINGS_INCOMPLETE_STATUS',
      'CHAT_GENERATION_SETTINGS_INCOMPLETE_ERROR',
      'CHAT_GENERATION_SETTINGS_INCOMPLETE_MESSAGE',
      'CHAT_GENERATION_SETTINGS_KEYS',
      'CHAT_GENERATION_SETTINGS_MISSING_REASON_CODES',
    ] as const) {
      expect(browserSettings[key]).toBe(sharedSettings[key])
    }
    for (const key of [
      'serializeChatGenerationSettingsDigestInput',
      'diffChatGenerationSettings',
      'applySparseChatGenerationSettingsUpdate',
      'resolveRequiredSidebarToggles',
      'resolveDisplayedSidebarToggles',
      'resolveChatGenerationControlRequirements',
      'resolveChatGenerationSettingsReadiness',
      'createChatGenerationSettingsIncompleteError',
    ] as const) {
      expect(browserSettings[key]).toBe(sharedSettings[key])
    }
  })
})
