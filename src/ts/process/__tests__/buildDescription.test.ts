import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

const additionalInformationMock = vi.hoisted(() => vi.fn(async () => ''))

vi.mock('../embedding/addinfo', () => ({
  additionalInformations: additionalInformationMock,
}))

import { getDatabase, setDatabase, type Chat, type Database, type character } from '../../storage/database.svelte'
import { testDatabaseState } from '../../__tests__/resourceDatabaseState'
import { buildDescription as buildDescriptionWithDatabase } from '../promptAssembly/buildDescription'

function buildDescription(currentChar: character, currentChat: Chat) {
  return buildDescriptionWithDatabase(currentChar, currentChat, getDatabase())
}

function makeChar(overrides: Partial<character> = {}): character {
  return {
    name: 'Test',
    chaId: 'cha-1',
    desc: 'a quiet librarian',
    personality: '',
    scenario: '',
    additionalText: '',
    chats: [],
    chatPage: 0,
    image: '',
    emotionImages: [],
    bias: [],
    viewScreen: 'none',
    globalLore: [],
    chaVer: 0,
    firstMessage: '',
    notes: '',
    ...overrides,
  } as unknown as character
}

function makeChat(): Chat {
  return { message: [], note: '', name: 'main', localLore: [] } as unknown as Chat
}

function seedDb(extra: Partial<Database> = {}) {
  setDatabase({
    characters: [makeChar()],
    promptPreprocess: false,
    descriptionPrefix: '',
    ...extra,
  } as unknown as Database)
}

describe('buildDescription', () => {
  beforeEach(() => {
    additionalInformationMock.mockReset().mockResolvedValue('')
    seedDb()
  })

  it('returns just the desc when no personality, scenario, or additionalText', async () => {
    const result = await buildDescription(makeChar(), makeChat())
    expect(result).toEqual({
      role: 'system',
      content: 'a quiet librarian',
    })
  })

  it('appends a personality block with the Description of {{char}} header', async () => {
    const result = await buildDescription(makeChar({ personality: 'kind and curious' }), makeChat())
    expect(result.content).toBe('a quiet librarian\n\nDescription of Test: kind and curious')
  })

  it('appends a scenario block with the Circumstances header', async () => {
    const result = await buildDescription(makeChar({ scenario: 'evening at the library' }), makeChat())
    expect(result.content).toBe(
      'a quiet librarian\n\nCircumstances and context of the dialogue: evening at the library',
    )
  })

  it('combines desc + personality + scenario in that exact order', async () => {
    const result = await buildDescription(
      makeChar({ personality: 'kind and curious', scenario: 'evening at the library' }),
      makeChat(),
    )
    expect(result.content).toBe(
      'a quiet librarian' +
        '\n\nDescription of Test: kind and curious' +
        '\n\nCircumstances and context of the dialogue: evening at the library',
    )
  })

  it('places retrieved additional information before personality and parses character variables', async () => {
    additionalInformationMock.mockResolvedValue('Retrieved note for {{char}}')
    const character = makeChar({ additionalText: 'indexed source', personality: 'kind' })
    const chat = makeChat()
    const result = await buildDescription(character, chat)
    expect(additionalInformationMock).toHaveBeenCalledWith(character, chat)
    expect(result.content).toBe('a quiet librarian\n\nRetrieved note for Test\n\nDescription of Test: kind')
  })

  it('applies descriptionPrefix when db.promptPreprocess is true', async () => {
    seedDb({ promptPreprocess: true, descriptionPrefix: 'PFX: ' })
    const result = await buildDescription(makeChar(), makeChat())
    expect(result.content).toBe('PFX: a quiet librarian')
  })

  it('skips descriptionPrefix when db.promptPreprocess is false', async () => {
    seedDb({ promptPreprocess: false, descriptionPrefix: 'PFX: ' })
    const result = await buildDescription(makeChar(), makeChat())
    expect(result.content).toBe('a quiet librarian')
  })

  it('returns role=system regardless of which sections are present', async () => {
    const r1 = await buildDescription(makeChar(), makeChat())
    const r2 = await buildDescription(makeChar({ personality: 'kind', scenario: 'library' }), makeChat())
    expect(r1.role).toBe('system')
    expect(r2.role).toBe('system')
  })

  it('reads descriptionPrefix from the resource database at call time', async () => {
    seedDb({ promptPreprocess: true, descriptionPrefix: 'first:' })
    const r1 = await buildDescription(makeChar(), makeChat())
    testDatabaseState.db.descriptionPrefix = 'second:'
    const r2 = await buildDescription(makeChar(), makeChat())
    expect(r1.content).toBe('first:a quiet librarian')
    expect(r2.content).toBe('second:a quiet librarian')
  })
})
