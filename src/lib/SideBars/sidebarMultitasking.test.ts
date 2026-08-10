import { afterEach, describe, expect, it } from 'vitest'
import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import {
  characterFolderHasGeneratingChat,
  characterHasGeneratingChat,
  collectGeneratingChatIds,
  collectPinnedChats,
} from './sidebarMultitasking'

const characters = [
  {
    chaId: 'char-a',
    name: 'Alpha',
    image: 'alpha.png',
    chats: [
      { id: 'chat-a1', name: 'First', pinned: true },
      { id: 'chat-a2', name: 'Second' },
    ],
  },
  {
    chaId: 'char-b',
    name: 'Beta',
    image: 'beta.png',
    chats: [
      { id: 'chat-b1', name: 'Third', pinned: true },
      { id: 'chat-b2', name: 'Fourth', pinned: true },
    ],
  },
] as any

afterEach(() => {
  changeLanguage('en')
})

describe('sidebar multitasking projections', () => {
  it('collects pinned chats in character-order and chat-order', () => {
    const pinned = collectPinnedChats(characters, [{ data: ['char-b'] }, 'char-a'] as any)

    expect(pinned.map((item) => `${item.characterId}:${item.chatId}`)).toEqual([
      'char-b:chat-b1',
      'char-b:chat-b2',
      'char-a:chat-a1',
    ])
  })

  it('uses the selected language fallback for empty and whitespace-only pinned chat names', () => {
    const unnamedChats = [
      {
        chaId: 'char-a',
        name: 'Alpha',
        image: 'alpha.png',
        chats: [
          { id: 'chat-empty', name: '', pinned: true },
          { id: 'chat-whitespace', name: ' \t ', pinned: true },
          { id: 'chat-named', name: '  Named chat  ', pinned: true },
        ],
      },
    ] as any

    expect(languageEnglish.unnamedPinnedChat).toBe('Chat')
    expect(languageKorean.unnamedPinnedChat).toBe('채팅')

    changeLanguage('en')
    expect(collectPinnedChats(unnamedChats, ['char-a']).map((item) => item.chatName)).toEqual([
      languageEnglish.unnamedPinnedChat,
      languageEnglish.unnamedPinnedChat,
      '  Named chat  ',
    ])

    changeLanguage('ko')
    expect(collectPinnedChats(unnamedChats, ['char-a']).map((item) => item.chatName)).toEqual([
      languageKorean.unnamedPinnedChat,
      languageKorean.unnamedPinnedChat,
      '  Named chat  ',
    ])
  })

  it('aggregates any number of generating chats into one character or folder truth value', () => {
    const generating = new Set(['chat-a1', 'chat-b1', 'chat-b2'])

    expect(characterHasGeneratingChat(characters[0], generating)).toBe(true)
    expect(characterHasGeneratingChat({ chats: [{ id: 'idle' }] } as any, generating)).toBe(false)
    expect(characterFolderHasGeneratingChat([0, 1], characters, generating)).toBe(true)
    expect(characterFolderHasGeneratingChat([], characters, generating)).toBe(false)
  })

  it('unions locally-starting and bootstrap-discovered message generations', () => {
    const ids = collectGeneratingChatIds(
      [{ chatId: 'server-chat' }],
      [
        { chatId: 'local-chat', kind: 'message' },
        { chatId: 'preview-chat', kind: 'preview' },
      ],
    )

    expect([...ids]).toEqual(['server-chat', 'local-chat'])
  })
})
