import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

const suggestionMocks = vi.hoisted(() => {
  function makeStore<T>(initial: T) {
    let value = initial
    const subscribers = new Set<(value: T) => void>()
    return {
      subscribe(callback: (value: T) => void) {
        callback(value)
        subscribers.add(callback)
        return () => subscribers.delete(callback)
      },
      set(next: T) {
        value = next
        for (const callback of subscribers) {
          callback(value)
        }
      },
    }
  }

  return {
    doingChat: makeStore(false),
    requestChatData: vi.fn(),
    translate: vi.fn(),
    alertConfirm: vi.fn(async () => false),
    dispatchUpdateChat: vi.fn(),
  }
})

vi.mock('../../ts/process/index.svelte', () => ({
  doingChat: suggestionMocks.doingChat,
}))

vi.mock('src/ts/process/request/request', () => ({
  requestChatData: suggestionMocks.requestChatData,
}))

vi.mock('src/ts/translator/translator', () => ({
  translate: suggestionMocks.translate,
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: suggestionMocks.alertConfirm,
}))

vi.mock('src/ts/parser/parser.svelte', () => ({
  ParseMarkdown: vi.fn(async (text: string) => text),
}))

vi.mock('src/ts/chatCommands', () => ({
  currentChatStateSnapshot: () => ({}),
  dispatchUpdateChat: suggestionMocks.dispatchUpdateChat,
}))

vi.mock('src/ts/process/modules', () => ({
  getModules: () => [],
  getModuleLorebooks: () => [],
  getModuleRegexScripts: () => [],
  getModuleTriggers: () => [],
  moduleUpdate: () => {},
}))

vi.mock('src/ts/process/scripts', () => ({
  resetScriptCache: vi.fn(),
}))

import Suggestion, { runSuggestionTranslation } from './Suggestion.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import type { Database } from 'src/ts/storage/database.svelte'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

type MountedComponent = Parameters<typeof unmount>[0]

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await tick()
    await Promise.resolve()
  }
}

async function waitFor(assertion: () => void) {
  let lastError: unknown
  for (let i = 0; i < 20; i += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await settle()
    }
  }
  throw lastError
}

function seedSuggestionDatabase(suggestMessages: string[] = ['Take the lead']) {
  selectedCharID.set(0)
  DBState.db = {
    autoSuggestClean: false,
    autoSuggestPrompt: '',
    autoTranslate: false,
    characters: [
      {
        chaId: 'character-a',
        name: 'Character A',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            name: 'Chat A',
            message: [{ role: 'char', data: 'Hello', chatId: 'message-a' }],
            suggestMessages,
          },
        ],
      },
    ],
    subModel: '',
    translator: '',
  } as unknown as Database
}

afterEach(() => {
  suggestionMocks.doingChat.set(false)
  selectedCharID.set(-1)
  DBState.db = {} as Database
  vi.clearAllMocks()
})

describe('runSuggestionTranslation', () => {
  it('L58: keeps only the newest overlapping translated suggestion run', async () => {
    const slowFirstMessage = deferred<string>()
    const commits: string[][] = []
    let currentRunId = 1
    let currentMessages: readonly string[] = ['slow-a', 'slow-b']

    const firstRun = runSuggestionTranslation({
      runId: 1,
      requestId: 1,
      toggle: true,
      messages: currentMessages,
      translationEnabled: () => true,
      getCurrentRunId: () => currentRunId,
      getCurrentRequestId: () => 1,
      getCurrentMessages: () => currentMessages,
      translateMessage: async (message) => (message === 'slow-a' ? slowFirstMessage.promise : `translated:${message}`),
      clear: vi.fn(),
      commit: (messages) => commits.push(messages),
    })

    currentRunId = 2
    currentMessages = ['fast']

    await runSuggestionTranslation({
      runId: 2,
      requestId: 1,
      toggle: true,
      messages: currentMessages,
      translationEnabled: () => true,
      getCurrentRunId: () => currentRunId,
      getCurrentRequestId: () => 1,
      getCurrentMessages: () => currentMessages,
      translateMessage: async (message) => `translated:${message}`,
      clear: vi.fn(),
      commit: (messages) => commits.push(messages),
    })

    slowFirstMessage.resolve('translated:slow-a')
    await firstRun

    expect(commits).toEqual([['translated:fast']])
  })

  it('L58: snapshots source messages and refuses a mutated-source commit', async () => {
    const sourceMessages = ['one', 'two']
    const translatedInputs: string[] = []
    const commits: string[][] = []

    await runSuggestionTranslation({
      runId: 1,
      requestId: 1,
      toggle: true,
      messages: sourceMessages,
      translationEnabled: () => true,
      getCurrentRunId: () => 1,
      getCurrentRequestId: () => 1,
      getCurrentMessages: () => sourceMessages,
      translateMessage: async (message) => {
        translatedInputs.push(message)
        if (message === 'one') {
          sourceMessages.push('three')
        }
        return `translated:${message}`
      },
      clear: vi.fn(),
      commit: (messages) => commits.push(messages),
    })

    expect(translatedInputs).toEqual(['one', 'two'])
    expect(commits).toEqual([])
  })

  it('L58: clears translated suggestions when translation is disabled', async () => {
    const clear = vi.fn()
    const translateMessage = vi.fn(async (message: string) => `translated:${message}`)

    await runSuggestionTranslation({
      runId: 1,
      requestId: 1,
      toggle: false,
      messages: ['one'],
      translationEnabled: () => true,
      getCurrentRunId: () => 1,
      getCurrentRequestId: () => 1,
      getCurrentMessages: () => ['one'],
      translateMessage,
      clear,
      commit: vi.fn(),
    })

    expect(clear).toHaveBeenCalledTimes(1)
    expect(translateMessage).not.toHaveBeenCalled()
  })
})

describe('Suggestion component persistence', () => {
  it('persists suggestion clearing when a suggestion is sent', async () => {
    seedSuggestionDatabase()
    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | undefined
    const send = vi.fn()
    const messageInput = vi.fn()

    try {
      component = mount(Suggestion, {
        target,
        props: {
          send,
          messageInput,
        },
      })

      await waitFor(() => {
        expect(target.textContent).toContain('Take the lead')
      })

      const suggestionButton = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
        button.textContent?.includes('Take the lead'),
      )
      expect(suggestionButton).toBeTruthy()
      suggestionButton!.click()
      await settle()

      expect(messageInput).toHaveBeenCalledWith('Take the lead')
      expect(send).toHaveBeenCalledTimes(1)
      expect(suggestionMocks.dispatchUpdateChat).toHaveBeenCalledWith('chat-a', { suggestMessages: [] }, {})
    } finally {
      if (component) unmount(component)
      target.remove()
    }
  })
})
