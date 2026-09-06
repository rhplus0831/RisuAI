import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../sha256Fallback'
import { createDraftHookTranslation } from './draftHookTranslation'

describe('createDraftHookTranslation', () => {
  it('stores the original text against the exact sent Draft output', async () => {
    const translation = await createDraftHookTranslation({
      hook: {
        id: 'translate-hook',
        name: 'Translate',
        type: 'draft',
        prompt: 'Translate {{slot::content}}',
        translation: true,
        model: { mode: 'modelProfile', profileId: 'profile-a' },
      },
      messageData: 'Draft output{{inlayed::asset-a}}',
      originalText: 'Original composer text',
      updatedAt: 123,
    })

    expect(translation).toEqual({
      text: 'Original composer text',
      source: 'raw',
      sourceHash: await sha256Hex('Draft output{{inlayed::asset-a}}'),
      targetLanguage: 'original',
      inputLanguage: 'auto',
      translatorType: 'llm',
      settingsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      updatedAt: 123,
    })
  })

  it('uses the hook behavior, not its display name, for translation identity', async () => {
    const baseHook = {
      id: 'hook-a',
      name: 'First name',
      type: 'draft' as const,
      prompt: 'Rewrite this.',
    }
    const first = await createDraftHookTranslation({
      hook: baseHook,
      messageData: 'output',
      originalText: 'source',
    })
    const renamed = await createDraftHookTranslation({
      hook: { ...baseHook, name: 'Renamed' },
      messageData: 'output',
      originalText: 'source',
    })
    const changedPrompt = await createDraftHookTranslation({
      hook: { ...baseHook, prompt: 'Translate this.' },
      messageData: 'output',
      originalText: 'source',
    })

    expect(renamed.settingsHash).toBe(first.settingsHash)
    expect(changedPrompt.settingsHash).not.toBe(first.settingsHash)
  })
})
