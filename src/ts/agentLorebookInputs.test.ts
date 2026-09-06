import { describe, expect, it } from 'vitest'
import type { Chat, character, loreBook } from './storage/database.svelte'
import { isAgentOnlyLorebookEntry, resolveAgentLorebookInput } from './agentLorebookInputs'

function entry(overrides: Partial<loreBook> = {}): loreBook {
  return {
    id: 'lore-a',
    key: '',
    secondkey: '',
    insertorder: 100,
    comment: 'Reference Notes',
    content: 'Reference content',
    mode: 'normal',
    alwaysActive: false,
    selective: false,
    agentOnly: true,
    ...overrides,
  }
}

function characterLore(globalLore: loreBook[]): Pick<character, 'globalLore'> {
  return { globalLore }
}

function chatLore(localLore: loreBook[]): Pick<Chat, 'localLore'> {
  return { localLore }
}

const requiredInput = { key: 'reference', displayName: 'Reference Notes', required: true }

describe('Agent lorebook input resolution', () => {
  it('uses a chat match before a character match', () => {
    const resolution = resolveAgentLorebookInput(
      requiredInput,
      characterLore([entry({ id: 'character', content: 'Character value' })]),
      chatLore([entry({ id: 'chat', content: 'Chat value' })]),
    )

    expect(resolution).toMatchObject({ status: 'resolved', scope: 'chat', content: 'Chat value' })
  })

  it('does not fall back when the chat-level override is invalid', () => {
    const resolution = resolveAgentLorebookInput(
      requiredInput,
      characterLore([entry({ id: 'character', content: 'Character value' })]),
      chatLore([entry({ id: 'chat', agentOnly: false })]),
    )

    expect(resolution).toMatchObject({ status: 'not_agent_only', scope: 'chat' })
  })

  it('reports duplicate display names within the winning scope', () => {
    const resolution = resolveAgentLorebookInput(
      requiredInput,
      characterLore([]),
      chatLore([entry({ id: 'one' }), entry({ id: 'two' })]),
    )

    expect(resolution).toMatchObject({ status: 'ambiguous', scope: 'chat' })
  })

  it('requires Always Active and both activation keys to remain disabled', () => {
    expect(
      resolveAgentLorebookInput(requiredInput, characterLore([entry({ alwaysActive: true })]), chatLore([])),
    ).toMatchObject({ status: 'invalid_activation', scope: 'character' })
    expect(
      resolveAgentLorebookInput(requiredInput, characterLore([entry({ secondkey: 'secondary' })]), chatLore([])),
    ).toMatchObject({ status: 'invalid_activation', scope: 'character' })
  })

  it('recognizes the portable character-card extension marker', () => {
    expect(
      isAgentOnlyLorebookEntry(
        entry({
          agentOnly: undefined,
          extentions: { risu_case_sensitive: false, risu_agent_only: true },
        }),
      ),
    ).toBe(true)
  })
})
