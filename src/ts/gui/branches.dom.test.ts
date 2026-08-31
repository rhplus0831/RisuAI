import { beforeEach, describe, expect, it } from 'vitest'
import { selectedCharID } from '../stores/coreStores.svelte'
import { applyServerChatMessagesResource, resetChatHydration } from '../server/chatMessageHydration.svelte'
import { charactersResourceState, replaceResourceDatabase } from '../server/resourceState.svelte'
import { getChatBranches } from './branches'

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function databaseFixture() {
  return {
    currentChar: 0,
    characterOrder: ['character-a', 'character-b'],
    characters: [
      {
        chaId: 'character-a',
        name: 'Character A',
        firstMessage: 'Shared greeting',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            fmIndex: -1,
            message: [{ role: 'user', data: 'Path A', chatId: 'message-a' }],
          },
          {
            id: 'chat-b',
            fmIndex: -1,
            message: [{ role: 'user', data: 'Path B', chatId: 'message-b' }],
          },
        ],
      },
      {
        chaId: 'character-b',
        name: 'Character B',
        firstMessage: 'Other greeting',
        chatPage: 0,
        chats: [
          {
            id: 'chat-c',
            fmIndex: -1,
            message: [{ role: 'user', data: 'Other path', chatId: 'message-c' }],
          },
        ],
      },
    ],
  }
}

function branchLayout() {
  return getChatBranches().map(({ x, y, connectX, connectY, multiChild, chatId }) => ({
    x,
    y,
    connectX,
    connectY,
    multiChild,
    chatId,
  }))
}

beforeEach(() => {
  resetChatHydration()
  replaceResourceDatabase(databaseFixture() as never, 1)
  selectedCharID.set(0)
})

describe('branch graph resource owners', () => {
  it('preserves branch layout and chat indexes for canonical owners', () => {
    expect(branchLayout()).toEqual([
      { x: 0, y: 0, connectX: -1, connectY: -1, multiChild: false, chatId: 0 },
      { x: 0, y: 1, connectX: 0, connectY: 0, multiChild: true, chatId: 0 },
      { x: 0, y: 1, connectX: 0, connectY: 0, multiChild: true, chatId: 1 },
    ])
  })

  it('uses the ready selected-character owner instead of a stale compatibility selection', () => {
    selectedCharID.set(1)

    expect(branchLayout()).toHaveLength(3)
    expect(branchLayout().map((branch) => branch.chatId)).toEqual([0, 0, 1])
  })

  it.each(['idle', 'loading'] as const)('fails closed while character owners are %s', (status) => {
    charactersResourceState.status = status
    charactersResourceState.currentChar = 1
    resetChatHydration()

    expect(branchLayout()).toEqual([])
  })

  it('fails closed when the character owner is in an error state', () => {
    charactersResourceState.status = 'error'

    expect(getChatBranches()).toEqual([])
  })

  it('fails closed for duplicate selected-character owners', () => {
    charactersResourceState.characters.push(cloneJson(charactersResourceState.characters[0]))

    expect(getChatBranches()).toEqual([])
  })

  it('fails closed for missing or globally duplicated chat ids', () => {
    charactersResourceState.characters[0].chats[0].id = ''
    expect(getChatBranches()).toEqual([])

    replaceResourceDatabase(databaseFixture() as never, 2)
    charactersResourceState.characters[1].chats.push(cloneJson(charactersResourceState.characters[0].chats[0]))
    expect(getChatBranches()).toEqual([])
  })

  it('fails closed for missing or duplicate message owners', () => {
    charactersResourceState.characters[0].chats[0].message[0].chatId = ''
    expect(getChatBranches()).toEqual([])

    replaceResourceDatabase(databaseFixture() as never, 2)
    charactersResourceState.characters[0].chats[0].message.push(
      cloneJson(charactersResourceState.characters[0].chats[0].message[0]),
    )
    expect(getChatBranches()).toEqual([])
  })

  it('renders from the transcript owner instead of a divergent resident chat body', () => {
    expect(
      applyServerChatMessagesResource(
        'chat-a',
        [{ role: 'user', data: 'Owner transcript', chatId: 'message-owner' }],
        undefined,
        [],
      ),
    ).toBe(true)
    const ownerGraph = getChatBranches()

    charactersResourceState.characters[0].chats[0].message = [
      { role: 'user', data: 'Divergent resident body', chatId: 'message-divergent' },
    ]

    expect(getChatBranches()).toEqual(ownerGraph)
  })
})
