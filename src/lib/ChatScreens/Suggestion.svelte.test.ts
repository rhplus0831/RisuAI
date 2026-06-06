import { describe, expect, it, vi } from 'vitest'

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

import { runSuggestionTranslation } from './Suggestion.svelte'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

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
      translateMessage: async (message) =>
        message === 'slow-a' ? slowFirstMessage.promise : `translated:${message}`,
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
