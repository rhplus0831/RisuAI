import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Database } from '../storage/database.svelte'
import { cleanAutoSuggestionInput } from './autoSuggestionCleanup'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function database(options: { profileModelId: string; flatSubModel: string; clean?: boolean }): Database {
  return {
    aiModel: 'gpt-5',
    subModel: options.flatSubModel,
    autoSuggestClean: options.clean ?? true,
    modelProfiles: [{ id: 'suggestion-aux', name: 'Suggestion Aux', modelId: options.profileModelId }],
    modelRoleProfiles: { chatAux: { mode: 'profile', profileId: 'suggestion-aux' } },
  } as Database
}

describe('auto-suggestion input cleanup', () => {
  it('uses the resolved auxiliary profile instead of a conflicting flat submodel', () => {
    const generated = 'Take the left path (confidence note)'

    expect(
      cleanAutoSuggestionInput(generated, database({ profileModelId: 'textgen_webui', flatSubModel: 'gpt-5' })),
    ).toBe('Take the left path')
    expect(
      cleanAutoSuggestionInput(generated, database({ profileModelId: 'gpt-5', flatSubModel: 'textgen_webui' })),
    ).toBe(generated)
  })

  it('preserves the generated text when automatic cleanup is disabled', () => {
    const generated = 'Take the left path - internal note'
    expect(
      cleanAutoSuggestionInput(
        generated,
        database({ profileModelId: 'textgen_webui', flatSubModel: 'gpt-5', clean: false }),
      ),
    ).toBe(generated)
  })

  it('keeps the chat screen off the flat auxiliary model field', () => {
    const chatScreen = fs.readFileSync(`${repoRoot}/src/lib/ChatScreens/DefaultChatScreen.svelte`, 'utf8')

    expect(chatScreen).toContain('cleanAutoSuggestionInput(msg, autoSuggestionCleanupDatabase)')
    expect(chatScreen).not.toContain('getDatabase().subModel')
  })
})
