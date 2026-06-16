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
import type { character } from 'src/ts/storage/database.svelte'

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
    textarea!.value = 'draft before close'
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    expect(authorNoteMocks.setChatNoteValue).not.toHaveBeenCalled()

    unmount(component)
    component = undefined

    expect(authorNoteMocks.setChatNoteValue).toHaveBeenCalledTimes(1)
    expect(authorNoteMocks.setChatNoteValue).toHaveBeenCalledWith('chat-a', 'draft before close')

    vi.advanceTimersByTime(300)
    expect(authorNoteMocks.setChatNoteValue).toHaveBeenCalledTimes(1)
  })
})
