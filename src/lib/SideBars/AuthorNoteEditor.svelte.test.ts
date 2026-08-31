import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authorNoteMocks = vi.hoisted(() => ({
  acknowledgePendingMutation: vi.fn(async () => 'deleted'),
  applyChatNoteValueLocally: vi.fn((_chatId: string, _note: string) => ({
    chatId: 'chat-a',
    selectedCharID: 0,
    scriptstate: undefined,
    note: 'initial note',
  })),
  dispatchStagedChatNoteMutation: vi.fn(async () => ({ status: 'ok', revision: 2, event: {} })),
  nextMutationId: 0,
  stageChatNoteMutation: vi.fn((input: Record<string, any>) => {
    const mutationId = `author-note-mutation-${++authorNoteMocks.nextMutationId}`
    return {
      chatId: input.chatId,
      characterId: input.characterId,
      note: input.note,
      intent: {
        version: 1,
        requests: [
          {
            method: 'PATCH',
            path: `/chats/${input.chatId}`,
            body: { patch: { note: input.note }, select: false },
          },
        ],
      },
      outbox: {
        key: `character-owner:${input.characterId}`,
        mutationId,
        sequence: authorNoteMocks.nextMutationId,
        ownerWriterSessionId: 'writer-a',
        writerEpoch: 1,
        databaseLineage: 'database-a',
        phase: 'staged',
        ready: Promise.resolve('persisted'),
      },
    }
  }),
  tokenizeAccurate: vi.fn(async () => 0),
}))

vi.mock('src/lang', () => ({
  language: {
    authorNote: 'Author note',
    help: {
      chatNote: 'Chat note help',
    },
    showHelp: 'Show help',
    tokens: 'tokens',
  },
}))

vi.mock('src/ts/chatCommands', () => ({
  applyChatNoteValueLocally: authorNoteMocks.applyChatNoteValueLocally,
  dispatchStagedChatNoteMutation: authorNoteMocks.dispatchStagedChatNoteMutation,
  stageChatNoteMutation: authorNoteMocks.stageChatNoteMutation,
}))

vi.mock('src/ts/server/pendingMutationOutbox', () => ({
  acknowledgePendingMutation: authorNoteMocks.acknowledgePendingMutation,
}))

vi.mock('src/ts/tokenizer', () => ({
  tokenizeAccurate: authorNoteMocks.tokenizeAccurate,
}))

vi.mock('src/ts/utilState', () => ({
  getAuthorNoteDefaultText: () => '',
}))

vi.mock('../UI/GUI/TextAreaInput.svelte', async () => {
  const mock = await import('./AuthorNoteEditor.testTextArea.svelte')
  return { default: mock.default }
})

vi.mock('../Others/Help.svelte', async () => {
  const mock = await import('./AuthorNoteEditor.testHelp.svelte')
  return { default: mock.default }
})

import AuthorNoteEditor from './AuthorNoteEditor.svelte'
import AuthorNoteEditorTestHost from './AuthorNoteEditor.testHost.svelte'
import type { character } from 'src/ts/storage/database.svelte'
import { flushRegisteredPendingBridgePatches } from 'src/ts/server/pendingBridgeFlushRegistry'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function makeCharacter(note = 'initial note'): character {
  return {
    chaId: 'character-a',
    name: 'Character A',
    chatPage: 0,
    chats: [
      {
        id: 'chat-a',
        name: 'Chat A',
        note,
        message: [],
      },
    ],
  } as unknown as character
}

function makeCharacterWithTwoChats(): character {
  const chara = makeCharacter('first note')
  chara.chats.push({
    id: 'chat-b',
    name: 'Chat B',
    note: 'second note',
    message: [],
  } as unknown as (typeof chara.chats)[number])
  return chara
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  authorNoteMocks.applyChatNoteValueLocally.mockReset()
  authorNoteMocks.applyChatNoteValueLocally.mockReturnValue({
    chatId: 'chat-a',
    selectedCharID: 0,
    scriptstate: undefined,
    note: 'initial note',
  })
  authorNoteMocks.nextMutationId = 0
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  document.body.innerHTML = ''
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('AuthorNoteEditor debounce persistence', () => {
  it('updates the live projection and watcher baseline immediately, then flushes transport on unmount', async () => {
    const chara = makeCharacter()
    authorNoteMocks.applyChatNoteValueLocally.mockImplementation((_chatId: string, note: string) => {
      const chat = chara.chats[0]
      const previous = {
        chatId: chat.id,
        selectedCharID: 0,
        scriptstate: undefined,
        note: chat.note ?? '',
      }
      chat.note = note
      return previous
    })
    component = mount(AuthorNoteEditor, {
      target,
      props: {
        chara,
      },
    })
    await tick()

    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="author-note-input"]')
    expect(textarea).toBeTruthy()
    expect(textarea?.getAttribute('aria-label')).toBe('Author note')
    textarea!.value = 'draft before close'
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    expect(chara.chats[0].note).toBe('draft before close')
    expect(authorNoteMocks.stageChatNoteMutation).toHaveBeenCalledWith({
      chatId: 'chat-a',
      characterId: 'character-a',
      note: 'draft before close',
      previous: undefined,
    })
    expect(authorNoteMocks.dispatchStagedChatNoteMutation).not.toHaveBeenCalled()

    unmount(component)
    component = undefined

    expect(authorNoteMocks.dispatchStagedChatNoteMutation).toHaveBeenCalledOnce()
    expect(authorNoteMocks.dispatchStagedChatNoteMutation).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-a', characterId: 'character-a', note: 'draft before close' }),
      expect.objectContaining({ note: 'initial note' }),
      {},
    )

    vi.advanceTimersByTime(300)
    expect(authorNoteMocks.dispatchStagedChatNoteMutation).toHaveBeenCalledOnce()
  })

  it('flushes the old chat draft before switching owners', async () => {
    component = mount(AuthorNoteEditorTestHost, {
      target,
      props: {
        initialCharacter: makeCharacterWithTwoChats(),
      },
    })
    await tick()

    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="author-note-input"]')!
    expect(textarea.dataset.popupEditorContext).toBe('chat-a')
    textarea.value = 'unsaved first-chat draft'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    expect(authorNoteMocks.dispatchStagedChatNoteMutation).not.toHaveBeenCalled()
    ;(component as unknown as { switchChat: (chatPage: number) => void }).switchChat(1)
    await tick()

    expect(authorNoteMocks.dispatchStagedChatNoteMutation).toHaveBeenCalledOnce()
    expect(authorNoteMocks.dispatchStagedChatNoteMutation).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-a', note: 'unsaved first-chat draft' }),
      expect.objectContaining({ note: 'initial note' }),
      {},
    )
    expect(textarea.value).toBe('second note')
    expect(textarea.dataset.popupEditorContext).toBe('chat-b')

    vi.advanceTimersByTime(300)
    expect(authorNoteMocks.dispatchStagedChatNoteMutation).toHaveBeenCalledOnce()
  })

  it('flushes a pending author-note edit with keepalive through the lifecycle registry', async () => {
    component = mount(AuthorNoteEditor, {
      target,
      props: {
        chara: makeCharacter(),
      },
    })
    await tick()

    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="author-note-input"]')!
    textarea.value = 'draft before pagehide'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))

    flushRegisteredPendingBridgePatches({ keepalive: true })

    expect(authorNoteMocks.dispatchStagedChatNoteMutation).toHaveBeenCalledOnce()
    expect(authorNoteMocks.dispatchStagedChatNoteMutation).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-a', note: 'draft before pagehide' }),
      expect.objectContaining({ note: 'initial note' }),
      { keepalive: true },
    )
    vi.advanceTimersByTime(300)
    expect(authorNoteMocks.dispatchStagedChatNoteMutation).toHaveBeenCalledOnce()
  })

  it('retains the earliest rollback while restaging an absolute desired note', async () => {
    authorNoteMocks.applyChatNoteValueLocally
      .mockReturnValueOnce({ chatId: 'chat-a', selectedCharID: 0, scriptstate: undefined, note: 'initial note' })
      .mockReturnValueOnce({ chatId: 'chat-a', selectedCharID: 0, scriptstate: undefined, note: 'older draft' })
    component = mount(AuthorNoteEditor, {
      target,
      props: {
        chara: makeCharacter(),
      },
    })
    await tick()

    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="author-note-input"]')!
    textarea.value = 'older draft'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    const firstOutbox = authorNoteMocks.stageChatNoteMutation.mock.results[0].value.outbox

    textarea.value = 'older draf'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    const secondStageInput = authorNoteMocks.stageChatNoteMutation.mock.calls[1][0]
    expect(secondStageInput).toMatchObject({
      chatId: 'chat-a',
      characterId: 'character-a',
      note: 'older draf',
      previous: firstOutbox,
    })
    expect(authorNoteMocks.stageChatNoteMutation.mock.results[1].value.intent.requests[0].body).toEqual({
      patch: { note: 'older draf' },
      select: false,
    })
    expect(authorNoteMocks.dispatchStagedChatNoteMutation).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)

    expect(authorNoteMocks.dispatchStagedChatNoteMutation).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'older draf' }),
      expect.objectContaining({ note: 'initial note' }),
      {},
    )
  })

  it('dispatches a marker-safe total revert immediately without waiting for the debounce timer', async () => {
    authorNoteMocks.applyChatNoteValueLocally
      .mockReturnValueOnce({ chatId: 'chat-a', selectedCharID: 0, scriptstate: undefined, note: 'initial note' })
      .mockReturnValueOnce({ chatId: 'chat-a', selectedCharID: 0, scriptstate: undefined, note: 'draft note' })
    component = mount(AuthorNoteEditor, {
      target,
      props: {
        chara: makeCharacter(),
      },
    })
    await tick()

    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="author-note-input"]')!
    textarea.value = 'draft note'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    expect(authorNoteMocks.dispatchStagedChatNoteMutation).not.toHaveBeenCalled()

    textarea.value = 'initial note'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    expect(authorNoteMocks.stageChatNoteMutation.mock.results[1].value.intent.requests[0].body).toEqual({
      patch: { note: 'initial note' },
      select: false,
    })
    expect(authorNoteMocks.dispatchStagedChatNoteMutation).toHaveBeenCalledOnce()
    expect(authorNoteMocks.dispatchStagedChatNoteMutation).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'initial note' }),
      expect.objectContaining({ note: 'initial note' }),
      {},
    )
    expect(authorNoteMocks.acknowledgePendingMutation).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)
    expect(authorNoteMocks.dispatchStagedChatNoteMutation).toHaveBeenCalledOnce()
  })
})
