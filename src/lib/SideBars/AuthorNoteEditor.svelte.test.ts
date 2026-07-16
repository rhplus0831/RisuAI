import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authorNoteMocks = vi.hoisted(() => ({
  setChatNoteValue: vi.fn(() => true),
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
  setChatNoteValue: authorNoteMocks.setChatNoteValue,
}))

vi.mock('src/ts/tokenizer', () => ({
  tokenizeAccurate: authorNoteMocks.tokenizeAccurate,
}))

vi.mock('src/ts/util', () => ({
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
  it('flushes a pending author-note edit when the component unmounts', async () => {
    component = mount(AuthorNoteEditor, {
      target,
      props: {
        chara: makeCharacter(),
      },
    })
    await tick()

    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="author-note-input"]')
    expect(textarea).toBeTruthy()
    expect(textarea?.getAttribute('aria-label')).toBe('Author note')
    textarea!.value = 'draft before close'
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    expect(authorNoteMocks.setChatNoteValue).not.toHaveBeenCalled()

    unmount(component)
    component = undefined

    expect(authorNoteMocks.setChatNoteValue).toHaveBeenCalledTimes(1)
    expect(authorNoteMocks.setChatNoteValue).toHaveBeenCalledWith('chat-a', 'draft before close', {})

    vi.advanceTimersByTime(300)
    expect(authorNoteMocks.setChatNoteValue).toHaveBeenCalledTimes(1)
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
    textarea.value = 'unsaved first-chat draft'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    expect(authorNoteMocks.setChatNoteValue).not.toHaveBeenCalled()
    ;(component as unknown as { switchChat: (chatPage: number) => void }).switchChat(1)
    await tick()

    expect(authorNoteMocks.setChatNoteValue).toHaveBeenCalledOnce()
    expect(authorNoteMocks.setChatNoteValue).toHaveBeenCalledWith('chat-a', 'unsaved first-chat draft', {})
    expect(textarea.value).toBe('second note')

    vi.advanceTimersByTime(300)
    expect(authorNoteMocks.setChatNoteValue).toHaveBeenCalledOnce()
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
    await tick()

    flushRegisteredPendingBridgePatches({ keepalive: true })

    expect(authorNoteMocks.setChatNoteValue).toHaveBeenCalledOnce()
    expect(authorNoteMocks.setChatNoteValue).toHaveBeenCalledWith('chat-a', 'draft before pagehide', {
      keepalive: true,
    })

    vi.advanceTimersByTime(300)
    expect(authorNoteMocks.setChatNoteValue).toHaveBeenCalledOnce()
  })
})
