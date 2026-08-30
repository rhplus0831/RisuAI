import { describe, expect, it } from 'vitest'
import type { Chat, Database } from '../storage/database.svelte'
import { getActivePromptPresetRegexScripts } from './promptPresetRegex'

function chat(promptPresetId: string): Chat {
  return { generationSettings: { promptPresetId } } as Chat
}

function database(promptPresets: unknown[]): Database {
  return {
    promptPresets,
    presetRegex: [{ id: 'legacy', in: 'legacy', out: 'legacy', type: 'editprocess' }],
  } as unknown as Database
}

describe('getActivePromptPresetRegexScripts', () => {
  it('fails closed instead of selecting the first duplicate prompt owner', () => {
    expect(
      getActivePromptPresetRegexScripts(
        database([
          { id: 'prompt-a', presetRegex: [{ id: 'first' }] },
          { id: 'prompt-a', presetRegex: [{ id: 'second' }] },
        ]),
        chat('prompt-a'),
      ),
    ).toEqual([])
  })

  it('does not use the aggregate regex when the selected prompt owner is missing', () => {
    expect(getActivePromptPresetRegexScripts(database([{ id: 'other' }]), chat('prompt-a'))).toEqual([])
  })
})
