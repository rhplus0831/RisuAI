import { describe, expect, it } from 'vitest'
import {
  SERVER_CHARACTER_PINNED_CHAT_SUMMARY_KEYS,
  SERVER_CHARACTER_SHELL_MARKER,
  SERVER_CHARACTER_SUMMARY_KEYS,
  SERVER_CHARACTER_SUMMARY_VERSION,
  SERVER_CHARACTERS_SUMMARY_PAYLOAD_KEYS,
  isServerCharacterSummary,
  isServerCharactersSummaryPayload,
  type ServerCharacterSummary,
  type ServerCharactersSummaryPayload,
} from './characterSummaryProtocol'

function characterSummary(overrides: Partial<ServerCharacterSummary> = {}): ServerCharacterSummary {
  return {
    [SERVER_CHARACTER_SHELL_MARKER]: true,
    chaId: 'char-a',
    type: 'character',
    name: 'Ada',
    displayName: 'Ada Lovelace',
    image: 'asset://ada',
    creatorNotes: '# `en`\nFirst programmer',
    trashTime: null,
    creation_date: 1,
    modification_date: 2,
    lastInteraction: 3,
    chatCount: 2,
    activeChatId: 'chat-a',
    chatIds: ['chat-a', 'chat-b'],
    pinnedChats: [{ id: 'chat-b', name: 'Pinned' }],
    ...overrides,
  }
}

function payload(overrides: Partial<ServerCharactersSummaryPayload> = {}): ServerCharactersSummaryPayload {
  return {
    version: SERVER_CHARACTER_SUMMARY_VERSION,
    revision: 7,
    characters: [characterSummary()],
    characterOrder: ['char-a'],
    currentChar: 0,
    ...overrides,
  }
}

describe('character summary protocol', () => {
  it('publishes stable exact-field lists for the versioned wire contract', () => {
    expect(SERVER_CHARACTER_PINNED_CHAT_SUMMARY_KEYS).toEqual(['id', 'name'])
    expect(SERVER_CHARACTER_SUMMARY_KEYS).toEqual([
      '__serverCharacterShell',
      'chaId',
      'type',
      'name',
      'displayName',
      'image',
      'creatorNotes',
      'trashTime',
      'creation_date',
      'modification_date',
      'lastInteraction',
      'chatCount',
      'activeChatId',
      'chatIds',
      'pinnedChats',
    ])
    expect(SERVER_CHARACTERS_SUMMARY_PAYLOAD_KEYS).toEqual([
      'version',
      'revision',
      'characters',
      'characterOrder',
      'currentChar',
    ])
  })

  it('accepts the canonical summary and envelope', () => {
    expect(isServerCharacterSummary(characterSummary())).toBe(true)
    expect(isServerCharactersSummaryPayload(payload())).toBe(true)
    expect(isServerCharactersSummaryPayload(payload({ characters: [], characterOrder: [], currentChar: -1 }))).toBe(
      true,
    )
  })

  it.each(['chats', 'messages', 'globalLore', 'hypaV3Data', 'prompts', 'customscript', 'triggerscript'])(
    'rejects the forbidden detail field %s',
    (field) => {
      expect(isServerCharacterSummary({ ...characterSummary(), [field]: [] })).toBe(false)
    },
  )

  it('rejects missing fields, extra envelope fields, and an invalid protocol version', () => {
    const missingImage = { ...characterSummary() } as Record<string, unknown>
    delete missingImage.image
    expect(isServerCharacterSummary(missingImage)).toBe(false)
    expect(isServerCharactersSummaryPayload({ ...payload(), extra: true })).toBe(false)
    expect(isServerCharactersSummaryPayload({ ...payload(), version: 2 })).toBe(false)
  })

  it('rejects inconsistent or ambiguous list metadata', () => {
    expect(isServerCharacterSummary(characterSummary({ chatCount: 1 }))).toBe(false)
    expect(isServerCharacterSummary(characterSummary({ chatIds: ['chat-a', 'chat-a'] }))).toBe(false)
    expect(isServerCharacterSummary(characterSummary({ activeChatId: 'missing' }))).toBe(false)
    expect(isServerCharacterSummary(characterSummary({ pinnedChats: [{ id: 'missing', name: 'Missing' }] }))).toBe(
      false,
    )
    expect(
      isServerCharacterSummary(
        characterSummary({
          pinnedChats: [
            { id: 'chat-b', name: 'Pinned' },
            { id: 'chat-b', name: 'Duplicate' },
          ],
        }),
      ),
    ).toBe(false)
    expect(isServerCharactersSummaryPayload(payload({ characters: [characterSummary(), characterSummary()] }))).toBe(
      false,
    )
  })
})
