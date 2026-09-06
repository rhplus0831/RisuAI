import { describe, expect, it, vi } from 'vitest'
import type { character } from 'src/ts/storage/database.svelte'
import { collectHomeRecentCharacters, HOME_RECENT_CHARACTER_LIMIT } from './mainMenuProjection'

function characterRow(input: {
  id: string
  name: string
  lastInteraction?: number
  chatIds?: string[]
  chatPage?: number
  trashTime?: number
}): character {
  return {
    chaId: input.id,
    name: input.name,
    lastInteraction: input.lastInteraction,
    trashTime: input.trashTime,
    chatPage: input.chatPage ?? 0,
    chats: (input.chatIds ?? []).map((id) => ({ id })),
  } as unknown as character
}

describe('main-menu recent character projection', () => {
  it('keeps only known, active characters and resumes their selected chats', () => {
    const agoFormatter = {
      format: vi.fn((value: number, unit: Intl.RelativeTimeFormatUnit) => `${value}:${unit}`),
    }
    const rows = collectHomeRecentCharacters(
      [
        characterRow({ id: 'older', name: 'Older', lastInteraction: 1_000, chatIds: ['old-chat'] }),
        characterRow({
          id: 'newer',
          name: 'Newer',
          lastInteraction: 3_000,
          chatIds: ['first-chat', 'active-chat'],
          chatPage: 1,
        }),
        characterRow({ id: 'trashed', name: 'Trashed', lastInteraction: 9_000, trashTime: 1 }),
        characterRow({ id: '§playground', name: 'Playground', lastInteraction: 8_000 }),
        characterRow({ id: 'unknown', name: 'Unknown' }),
      ],
      { agoFormatter, unknownText: 'Unknown', now: 3_000 },
    )

    expect(rows.map((row) => row.characterId)).toEqual(['newer', 'older'])
    expect(rows[0]).toMatchObject({
      characterIndex: 1,
      characterName: 'Newer',
      activeChatId: 'active-chat',
      agoText: '0:minute',
    })
  })

  it('caps the home section without changing the shared character order', () => {
    const characters = Array.from({ length: HOME_RECENT_CHARACTER_LIMIT + 3 }, (_, index) =>
      characterRow({
        id: `character-${index}`,
        name: `Character ${index}`,
        lastInteraction: index + 1,
      }),
    )

    const rows = collectHomeRecentCharacters(characters, {
      agoFormatter: new Intl.RelativeTimeFormat('en', { style: 'short' }),
      unknownText: 'Unknown',
      now: 100,
    })

    expect(rows).toHaveLength(HOME_RECENT_CHARACTER_LIMIT)
    expect(rows[0].characterId).toBe(`character-${HOME_RECENT_CHARACTER_LIMIT + 2}`)
    expect(rows.at(-1)?.characterId).toBe('character-3')
  })
})
