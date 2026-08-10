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
    dispatchUpdateChatRow: vi.fn(),
    rollbackServerBackedChatRowMetadata: vi.fn(),
    syncServerBackedChatMetadataBaselines: vi.fn(),
    withTrustedResourceWrite: vi.fn((callback: () => void) => callback()),
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
  dispatchUpdateChatRow: suggestionMocks.dispatchUpdateChatRow,
}))

vi.mock('src/ts/server/chatBridge.svelte', () => ({
  rollbackServerBackedChatRowMetadata: suggestionMocks.rollbackServerBackedChatRowMetadata,
  syncServerBackedChatMetadataBaselines: suggestionMocks.syncServerBackedChatMetadataBaselines,
}))

vi.mock('src/ts/server/resourceWriteGuard.svelte', () => ({
  withTrustedResourceWrite: suggestionMocks.withTrustedResourceWrite,
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
import { language } from 'src/lang'
import { selectedCharID } from 'src/ts/stores.svelte'
import { getResourceDatabase, replaceResourceDatabase } from 'src/ts/server/resourceState.svelte'
import type { Database } from 'src/ts/storage/database.svelte'
import { defaultAutoSuggestPrompt } from 'src/ts/storage/defaultPrompts'
import { replacePlaceholders } from 'src/ts/utilState'
import {
  beginChatGenerationActivity,
  finishChatGenerationActivity,
  resetChatGenerationActivitiesForTests,
} from 'src/ts/process/generationActivity.svelte'

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

function seedSuggestionDatabase(suggestMessages: string[] = ['Take the lead'], translator = '') {
  selectedCharID.set(0)
  replaceResourceDatabase({
    autoSuggestClean: false,
    autoSuggestPrompt: '',
    characters: [
      {
        chaId: 'character-a',
        name: 'Character A',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            name: 'Chat A',
            autoTranslate: false,
            message: [{ role: 'char', data: 'Hello', chatId: 'message-a' }],
            suggestMessages,
          },
        ],
      },
    ],
    subModel: '',
    translator,
  } as unknown as Database)
}

function seedSuggestionDatabaseWithTwoChats() {
  selectedCharID.set(0)
  replaceResourceDatabase({
    autoSuggestClean: false,
    autoSuggestPrompt: '',
    characters: [
      {
        chaId: 'character-a',
        name: 'Character A',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            name: 'Chat A',
            autoTranslate: false,
            message: [{ role: 'char', data: 'Hello from A', chatId: 'message-a' }],
            suggestMessages: ['Take the lead'],
          },
          {
            id: 'chat-b',
            name: 'Chat B',
            message: [{ role: 'char', data: 'Hello from B', chatId: 'message-b' }],
            suggestMessages: [],
          },
        ],
      },
    ],
    subModel: '',
    translator: '',
  } as unknown as Database)
}

function seedBackgroundSuggestionDatabase(options: { shell?: boolean } = {}) {
  seedSuggestionDatabaseWithTwoChats()
  const character = getResourceDatabase().characters[0]
  character.chats[0].message = options.shell
    ? []
    : [{ role: 'char', data: 'Resident reply from A', chatId: 'message-a' }]
  character.chats[0].suggestMessages = []
  character.chats[1].suggestMessages = ['Keep B suggestion']
}

function beginChatAGeneration() {
  return beginChatGenerationActivity({
    target: {
      selectedCharID: 0,
      chatPage: 0,
      characterId: 'character-a',
      chatId: 'chat-a',
    },
    kind: 'message',
  })!
}

afterEach(() => {
  resetChatGenerationActivitiesForTests()
  suggestionMocks.doingChat.set(false)
  selectedCharID.set(-1)
  replaceResourceDatabase({} as Database)
  vi.clearAllMocks()
})

describe('Suggestion controls', () => {
  it('names icon actions and exposes the translation toggle state', async () => {
    seedSuggestionDatabase(['Take the lead'], 'google')
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(Suggestion, { target, props: { send: vi.fn(), messageInput: vi.fn() } })

    try {
      await settle()
      expect(target.querySelector(`button[aria-label="${language.translate}"]`)?.getAttribute('aria-pressed')).toBe(
        'false',
      )
      expect(target.querySelector(`button[aria-label="${language.reroll}"]`)).toBeTruthy()
      expect(target.querySelector('button[aria-label="Take the lead"]')).toBeTruthy()
      expect(target.querySelector(`button[aria-label="${language.copy}: Take the lead"]`)).toBeTruthy()
    } finally {
      unmount(component)
      target.remove()
    }
  })

  it("defaults the translation toggle from the active chat's auto-translate setting", async () => {
    seedSuggestionDatabase(['Take the lead'], 'google')
    getResourceDatabase().characters[0].chats[0].autoTranslate = true
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(Suggestion, { target, props: { send: vi.fn(), messageInput: vi.fn() } })

    try {
      await settle()
      expect(target.querySelector(`button[aria-label="${language.translate}"]`)?.getAttribute('aria-pressed')).toBe(
        'true',
      )
    } finally {
      unmount(component)
      target.remove()
    }
  })
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
      isOwnerCurrent: () => true,
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
      isOwnerCurrent: () => true,
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
      isOwnerCurrent: () => true,
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

  it('does not commit a translation after its owner is invalidated', async () => {
    const translated = deferred<string>()
    const commit = vi.fn()
    let ownerCurrent = true

    const run = runSuggestionTranslation({
      runId: 1,
      requestId: 1,
      toggle: true,
      messages: ['pending'],
      translationEnabled: () => true,
      getCurrentRunId: () => 1,
      getCurrentRequestId: () => 1,
      getCurrentMessages: () => ['pending'],
      isOwnerCurrent: () => ownerCurrent,
      translateMessage: () => translated.promise,
      clear: vi.fn(),
      commit,
    })

    ownerCurrent = false
    translated.resolve('abandoned translation')
    await run

    expect(commit).not.toHaveBeenCalled()
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
      isOwnerCurrent: () => true,
      translateMessage,
      clear,
      commit: vi.fn(),
    })

    expect(clear).toHaveBeenCalledTimes(1)
    expect(translateMessage).not.toHaveBeenCalled()
  })
})

describe('Suggestion component persistence', () => {
  it('keeps an in-flight generation lease while reroll confirmation settles', async () => {
    seedSuggestionDatabase(['Take the lead'])
    const confirmation = deferred<boolean>()
    suggestionMocks.alertConfirm.mockReturnValueOnce(confirmation.promise)
    const observedDoingChat: boolean[] = []
    const unsubscribe = suggestionMocks.doingChat.subscribe((value) => observedDoingChat.push(value))
    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | undefined

    try {
      component = mount(Suggestion, {
        target,
        props: { send: vi.fn(), messageInput: vi.fn() },
      })
      await waitFor(() => {
        expect(target.querySelector(`button[aria-label="${language.reroll}"]`)).toBeTruthy()
      })

      target.querySelector<HTMLButtonElement>(`button[aria-label="${language.reroll}"]`)!.click()
      suggestionMocks.doingChat.set(true)
      confirmation.resolve(true)
      await settle()

      expect(observedDoingChat).toEqual([false, true])
      expect(suggestionMocks.requestChatData).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
      if (component) unmount(component)
      target.remove()
    }
  })

  it('requests an idle suggestion reroll without pulsing the generation lease', async () => {
    seedSuggestionDatabase(['Take the lead'])
    suggestionMocks.alertConfirm.mockResolvedValueOnce(true)
    suggestionMocks.requestChatData.mockResolvedValue({ type: 'success', result: '- Follow the new path' })
    const observedDoingChat: boolean[] = []
    const unsubscribe = suggestionMocks.doingChat.subscribe((value) => observedDoingChat.push(value))
    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | undefined

    try {
      component = mount(Suggestion, {
        target,
        props: { send: vi.fn(), messageInput: vi.fn() },
      })
      await waitFor(() => {
        expect(target.querySelector(`button[aria-label="${language.reroll}"]`)).toBeTruthy()
      })

      target.querySelector<HTMLButtonElement>(`button[aria-label="${language.reroll}"]`)!.click()
      await waitFor(() => {
        expect(target.textContent).toContain('Follow the new path')
      })

      expect(observedDoingChat).toEqual([false])
      expect(suggestionMocks.requestChatData).toHaveBeenCalledOnce()
    } finally {
      unsubscribe()
      if (component) unmount(component)
      target.remove()
    }
  })

  it('starts one suggestion request when an empty chat shell hydrates with messages', async () => {
    seedSuggestionDatabase([])
    getResourceDatabase().characters[0].chats[0].message = []
    const request = deferred<{ type: 'success'; result: string }>()
    suggestionMocks.requestChatData.mockReturnValue(request.promise)
    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | undefined

    try {
      component = mount(Suggestion, {
        target,
        props: { send: vi.fn(), messageInput: vi.fn() },
      })
      await settle()

      expect(suggestionMocks.requestChatData).not.toHaveBeenCalled()

      getResourceDatabase().characters[0].chats[0].message = [
        { role: 'char', data: 'Hydrated hello', chatId: 'hydrated-message' },
      ]
      await waitFor(() => expect(suggestionMocks.requestChatData).toHaveBeenCalledOnce())
      await settle()
      expect(suggestionMocks.requestChatData).toHaveBeenCalledOnce()

      request.resolve({ type: 'success', result: '- Hydrated suggestion' })
      await waitFor(() => {
        expect(target.textContent).toContain('Hydrated suggestion')
        expect(getResourceDatabase().characters[0].chats[0].suggestMessages).toEqual(['Hydrated suggestion'])
        expect(suggestionMocks.dispatchUpdateChatRow).toHaveBeenCalledOnce()
      })
    } finally {
      if (component) unmount(component)
      target.remove()
    }
  })

  it('requests suggestions once after a resident chat completes in the background and is reopened', async () => {
    seedBackgroundSuggestionDatabase()
    const generation = beginChatAGeneration()
    suggestionMocks.doingChat.set(true)
    const request = deferred<{ type: 'success'; result: string }>()
    suggestionMocks.requestChatData.mockReturnValue(request.promise)
    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | undefined

    try {
      component = mount(Suggestion, {
        target,
        props: { send: vi.fn(), messageInput: vi.fn() },
      })
      await settle()

      getResourceDatabase().characters[0].chatPage = 1
      suggestionMocks.doingChat.set(false)
      await settle()
      finishChatGenerationActivity(generation.id)
      await settle()

      expect(suggestionMocks.requestChatData).not.toHaveBeenCalled()
      expect(target.textContent).toContain('Keep B suggestion')

      getResourceDatabase().characters[0].chatPage = 0
      await waitFor(() => expect(suggestionMocks.requestChatData).toHaveBeenCalledOnce())
      const [requestArg] = suggestionMocks.requestChatData.mock.calls[0]
      expect(requestArg.currentChar.chaId).toBe('character-a')

      request.resolve({ type: 'success', result: '- Return to A' })
      await waitFor(() => {
        expect(target.textContent).toContain('Return to A')
        expect(getResourceDatabase().characters[0].chats[0].suggestMessages).toEqual(['Return to A'])
      })
      expect(getResourceDatabase().characters[0].chats[1].suggestMessages).toEqual(['Keep B suggestion'])
      expect(suggestionMocks.dispatchUpdateChatRow).toHaveBeenCalledOnce()
      expect(suggestionMocks.dispatchUpdateChatRow).toHaveBeenCalledWith(
        'chat-a',
        { suggestMessages: ['Return to A'] },
        expect.objectContaining({ characterId: 'character-a', chatId: 'chat-a' }),
        {},
        suggestionMocks.rollbackServerBackedChatRowMetadata,
      )
    } finally {
      if (component) unmount(component)
      target.remove()
    }
  })

  it('waits for a background-completed chat shell to hydrate before requesting suggestions once', async () => {
    seedBackgroundSuggestionDatabase({ shell: true })
    const generation = beginChatAGeneration()
    suggestionMocks.doingChat.set(true)
    const request = deferred<{ type: 'success'; result: string }>()
    suggestionMocks.requestChatData.mockReturnValue(request.promise)
    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | undefined

    try {
      component = mount(Suggestion, {
        target,
        props: { send: vi.fn(), messageInput: vi.fn() },
      })
      await settle()

      getResourceDatabase().characters[0].chatPage = 1
      suggestionMocks.doingChat.set(false)
      await settle()
      finishChatGenerationActivity(generation.id)
      await settle()

      getResourceDatabase().characters[0].chatPage = 0
      await settle()
      expect(suggestionMocks.requestChatData).not.toHaveBeenCalled()

      getResourceDatabase().characters[0].chats[0].message = [
        { role: 'char', data: 'Hydrated background reply', chatId: 'hydrated-message-a' },
      ]
      await waitFor(() => expect(suggestionMocks.requestChatData).toHaveBeenCalledOnce())

      request.resolve({ type: 'success', result: '- Hydrated return to A' })
      await waitFor(() => {
        expect(target.textContent).toContain('Hydrated return to A')
        expect(getResourceDatabase().characters[0].chats[0].suggestMessages).toEqual(['Hydrated return to A'])
      })
      expect(getResourceDatabase().characters[0].chats[1].suggestMessages).toEqual(['Keep B suggestion'])
      expect(suggestionMocks.dispatchUpdateChatRow).toHaveBeenCalledOnce()
    } finally {
      if (component) unmount(component)
      target.remove()
    }
  })

  it('uses persisted suggestions for a background completion without issuing a duplicate request', async () => {
    seedBackgroundSuggestionDatabase()
    const generation = beginChatAGeneration()
    suggestionMocks.doingChat.set(true)
    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | undefined

    try {
      component = mount(Suggestion, {
        target,
        props: { send: vi.fn(), messageInput: vi.fn() },
      })
      await settle()

      getResourceDatabase().characters[0].chatPage = 1
      suggestionMocks.doingChat.set(false)
      await settle()
      finishChatGenerationActivity(generation.id)
      getResourceDatabase().characters[0].chats[0].suggestMessages = ['Persisted background suggestion']
      await settle()

      getResourceDatabase().characters[0].chatPage = 0
      await waitFor(() => {
        expect(target.textContent).toContain('Persisted background suggestion')
      })

      expect(suggestionMocks.requestChatData).not.toHaveBeenCalled()
      expect(getResourceDatabase().characters[0].chats[1].suggestMessages).toEqual(['Keep B suggestion'])
      expect(suggestionMocks.dispatchUpdateChatRow).not.toHaveBeenCalled()
    } finally {
      if (component) unmount(component)
      target.remove()
    }
  })

  it('does not persist a background suggestion response after its chat becomes stale', async () => {
    seedBackgroundSuggestionDatabase()
    const generation = beginChatAGeneration()
    suggestionMocks.doingChat.set(true)
    const request = deferred<{ type: 'success'; result: string }>()
    suggestionMocks.requestChatData.mockReturnValue(request.promise)
    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | undefined

    try {
      component = mount(Suggestion, {
        target,
        props: { send: vi.fn(), messageInput: vi.fn() },
      })
      await settle()

      getResourceDatabase().characters[0].chatPage = 1
      suggestionMocks.doingChat.set(false)
      await settle()
      finishChatGenerationActivity(generation.id)
      getResourceDatabase().characters[0].chatPage = 0
      await waitFor(() => expect(suggestionMocks.requestChatData).toHaveBeenCalledOnce())

      const requestSignal = suggestionMocks.requestChatData.mock.calls[0][2] as AbortSignal
      getResourceDatabase().characters[0].chatPage = 1
      await waitFor(() => expect(requestSignal.aborted).toBe(true))

      request.resolve({ type: 'success', result: '- Stale response for A' })
      await settle()

      expect(getResourceDatabase().characters[0].chats[0].suggestMessages).toEqual([])
      expect(getResourceDatabase().characters[0].chats[1].suggestMessages).toEqual(['Keep B suggestion'])
      expect(target.textContent).not.toContain('Stale response for A')
      expect(suggestionMocks.dispatchUpdateChatRow).not.toHaveBeenCalled()
    } finally {
      if (component) unmount(component)
      target.remove()
    }
  })

  it('deduplicates automatic suggestion requests already in flight for the same chat', async () => {
    seedSuggestionDatabase([])
    const request = deferred<{ type: 'success'; result: string }>()
    suggestionMocks.requestChatData.mockReturnValue(request.promise)
    const firstTarget = document.createElement('div')
    const secondTarget = document.createElement('div')
    document.body.append(firstTarget, secondTarget)
    let firstComponent: MountedComponent | undefined
    let secondComponent: MountedComponent | undefined

    try {
      firstComponent = mount(Suggestion, {
        target: firstTarget,
        props: { send: vi.fn(), messageInput: vi.fn() },
      })
      secondComponent = mount(Suggestion, {
        target: secondTarget,
        props: { send: vi.fn(), messageInput: vi.fn() },
      })

      await waitFor(() => expect(suggestionMocks.requestChatData).toHaveBeenCalledOnce())
      await settle()
      expect(suggestionMocks.requestChatData).toHaveBeenCalledOnce()
    } finally {
      if (firstComponent) unmount(firstComponent)
      if (secondComponent) unmount(secondComponent)
      firstTarget.remove()
      secondTarget.remove()
    }
  })

  it('aborts an unmounted request and lets only the remounted owner persist', async () => {
    seedSuggestionDatabase([])
    const abandonedRequest = deferred<{ type: 'success'; result: string }>()
    const currentRequest = deferred<{ type: 'success'; result: string }>()
    suggestionMocks.requestChatData
      .mockReset()
      .mockReturnValueOnce(abandonedRequest.promise)
      .mockReturnValueOnce(currentRequest.promise)
    const target = document.createElement('div')
    document.body.appendChild(target)
    let abandonedComponent: MountedComponent | undefined
    let currentComponent: MountedComponent | undefined

    try {
      abandonedComponent = mount(Suggestion, {
        target,
        props: {
          send: vi.fn(),
          messageInput: vi.fn(),
        },
      })

      await waitFor(() => expect(suggestionMocks.requestChatData).toHaveBeenCalledTimes(1))
      const abandonedSignal = suggestionMocks.requestChatData.mock.calls[0][2] as AbortSignal
      expect(abandonedSignal.aborted).toBe(false)

      unmount(abandonedComponent)
      abandonedComponent = undefined
      await settle()

      expect(abandonedSignal.aborted).toBe(true)

      currentComponent = mount(Suggestion, {
        target,
        props: {
          send: vi.fn(),
          messageInput: vi.fn(),
        },
      })
      await waitFor(() => expect(suggestionMocks.requestChatData).toHaveBeenCalledTimes(2))
      const currentSignal = suggestionMocks.requestChatData.mock.calls[1][2] as AbortSignal
      expect(currentSignal.aborted).toBe(false)

      abandonedRequest.resolve({ type: 'success', result: '- Abandoned suggestion' })
      await settle()

      expect(target.textContent).not.toContain('Abandoned suggestion')
      expect(getResourceDatabase().characters[0].chats[0].suggestMessages).toEqual([])
      expect(suggestionMocks.syncServerBackedChatMetadataBaselines).not.toHaveBeenCalled()
      expect(suggestionMocks.dispatchUpdateChatRow).not.toHaveBeenCalled()

      currentRequest.resolve({ type: 'success', result: '- Current suggestion' })
      await waitFor(() => {
        expect(target.textContent).toContain('Current suggestion')
        expect(getResourceDatabase().characters[0].chats[0].suggestMessages).toEqual(['Current suggestion'])
        expect(suggestionMocks.dispatchUpdateChatRow).toHaveBeenCalledOnce()
      })
    } finally {
      if (abandonedComponent) unmount(abandonedComponent)
      if (currentComponent) unmount(currentComponent)
      target.remove()
    }
  })

  it('releases the loading state when suggestion generation rejects', async () => {
    seedSuggestionDatabase([])
    suggestionMocks.requestChatData.mockRejectedValueOnce(new Error('provider hook failed'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | undefined

    try {
      component = mount(Suggestion, {
        target,
        props: {
          send: vi.fn(),
          messageInput: vi.fn(),
        },
      })

      await waitFor(() => {
        expect(suggestionMocks.requestChatData).toHaveBeenCalledOnce()
        expect(target.querySelector('.loadmove')).toBeNull()
      })

      expect(target.querySelectorAll('button')).toHaveLength(1)
      expect(consoleError).toHaveBeenCalledWith('Failed to generate suggestions:', expect.any(Error))
    } finally {
      consoleError.mockRestore()
      if (component) unmount(component)
      target.remove()
    }
  })

  it('routes generated suggestions through otherAx and shapes prompts from the resolved otherAx model', async () => {
    seedSuggestionDatabase([])
    getResourceDatabase().autoSuggestPrompt = 'Suggest next lines for {{char}}'
    getResourceDatabase().subModel = 'openai_submodel'
    getResourceDatabase().seperateModelsForAxModels = true
    getResourceDatabase().seperateModels = {
      otherAx: 'local_test',
    } as Database['seperateModels']
    suggestionMocks.requestChatData.mockResolvedValue({ type: 'success', result: '- Try the local branch' })
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
        expect(suggestionMocks.requestChatData).toHaveBeenCalled()
      })

      const [requestArg, requestMode] = suggestionMocks.requestChatData.mock.calls[0]
      expect(requestMode).toBe('otherAx')
      expect(requestArg.formated).toEqual([
        { role: 'system', content: 'Suggest next lines for Character A' },
        { role: 'assistant', content: 'Hello' },
      ])
    } finally {
      if (component) unmount(component)
      target.remove()
    }
  })

  it('uses the default prompt for local suggestion models when the saved prompt is empty', async () => {
    seedSuggestionDatabase([])
    getResourceDatabase().seperateModelsForAxModels = true
    getResourceDatabase().seperateModels = {
      otherAx: 'local_test',
    } as Database['seperateModels']
    suggestionMocks.requestChatData.mockResolvedValue({ type: 'success', result: '- Try the local branch' })
    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | undefined

    try {
      component = mount(Suggestion, {
        target,
        props: {
          send: vi.fn(),
          messageInput: vi.fn(),
        },
      })

      await waitFor(() => {
        expect(suggestionMocks.requestChatData).toHaveBeenCalled()
      })

      const [requestArg] = suggestionMocks.requestChatData.mock.calls[0]
      expect(requestArg.formated[0]).toEqual({
        role: 'system',
        content: replacePlaceholders(defaultAutoSuggestPrompt, 'Character A'),
      })
    } finally {
      if (component) unmount(component)
      target.remove()
    }
  })

  it('persists suggestion clearing when a suggestion is sent', async () => {
    seedSuggestionDatabaseWithTwoChats()
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
      expect(getResourceDatabase().characters[0].chats[0].suggestMessages).toEqual([])
      expect(target.textContent).not.toContain('Take the lead')
      expect(suggestionMocks.withTrustedResourceWrite).toHaveBeenCalledOnce()
      expect(suggestionMocks.syncServerBackedChatMetadataBaselines).toHaveBeenCalledOnce()
      expect(suggestionMocks.dispatchUpdateChatRow).toHaveBeenCalledWith(
        'chat-a',
        { suggestMessages: [] },
        {
          selectedCharID: 0,
          characterId: 'character-a',
          chatId: 'chat-a',
          metadata: { suggestMessages: ['Take the lead'] },
        },
        {},
        suggestionMocks.rollbackServerBackedChatRowMetadata,
      )

      getResourceDatabase().characters[0].chatPage = 1
      await settle()
      getResourceDatabase().characters[0].chatPage = 0
      await settle()
      expect(target.textContent).not.toContain('Take the lead')
    } finally {
      if (component) unmount(component)
      target.remove()
    }
  })

  it('replaces stale suggestions after generation starts outside the suggestion buttons', async () => {
    seedSuggestionDatabaseWithTwoChats()
    suggestionMocks.requestChatData.mockResolvedValue({ type: 'success', result: '- Follow the new path' })
    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | undefined

    try {
      component = mount(Suggestion, {
        target,
        props: {
          send: vi.fn(),
          messageInput: vi.fn(),
        },
      })

      await waitFor(() => {
        expect(target.textContent).toContain('Take the lead')
      })

      suggestionMocks.doingChat.set(true)
      await settle()

      expect(getResourceDatabase().characters[0].chats[0].suggestMessages).toEqual([])
      expect(target.textContent).not.toContain('Take the lead')

      suggestionMocks.doingChat.set(false)
      await waitFor(() => {
        expect(target.textContent).toContain('Follow the new path')
        expect(getResourceDatabase().characters[0].chats[0].suggestMessages).toEqual(['Follow the new path'])
      })

      getResourceDatabase().characters[0].chatPage = 1
      await settle()
      getResourceDatabase().characters[0].chatPage = 0
      await settle()

      expect(target.textContent).toContain('Follow the new path')
      expect(target.textContent).not.toContain('Take the lead')
      expect(suggestionMocks.dispatchUpdateChatRow).toHaveBeenNthCalledWith(
        1,
        'chat-a',
        { suggestMessages: [] },
        {
          selectedCharID: 0,
          characterId: 'character-a',
          chatId: 'chat-a',
          metadata: { suggestMessages: ['Take the lead'] },
        },
        {},
        suggestionMocks.rollbackServerBackedChatRowMetadata,
      )
      expect(suggestionMocks.dispatchUpdateChatRow).toHaveBeenNthCalledWith(
        2,
        'chat-a',
        { suggestMessages: ['Follow the new path'] },
        {
          selectedCharID: 0,
          characterId: 'character-a',
          chatId: 'chat-a',
          metadata: { suggestMessages: [] },
        },
        {},
        suggestionMocks.rollbackServerBackedChatRowMetadata,
      )
    } finally {
      if (component) unmount(component)
      target.remove()
    }
  })

  it('does not reroll suggestions for a chat that became stale during confirmation', async () => {
    seedSuggestionDatabaseWithTwoChats()
    const confirmation = deferred<boolean>()
    suggestionMocks.alertConfirm.mockReturnValueOnce(confirmation.promise)
    suggestionMocks.requestChatData.mockResolvedValue({ type: 'success', result: '- Fresh suggestion' })
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

      const rerollButton = target.querySelector<HTMLButtonElement>('button')
      expect(rerollButton).toBeTruthy()
      rerollButton!.click()

      getResourceDatabase().characters[0].chatPage = 1
      await settle()
      confirmation.resolve(true)
      await settle()

      expect(suggestionMocks.dispatchUpdateChatRow).not.toHaveBeenCalled()
      expect(suggestionMocks.requestChatData).not.toHaveBeenCalled()
      expect(messageInput).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
    } finally {
      if (component) unmount(component)
      target.remove()
    }
  })

  it('ignores a stale rendered suggestion send after the active chat changes', async () => {
    seedSuggestionDatabaseWithTwoChats()
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

      getResourceDatabase().characters[0].chatPage = 1
      suggestionButton!.click()
      await settle()

      expect(messageInput).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
      expect(suggestionMocks.dispatchUpdateChatRow).not.toHaveBeenCalled()
    } finally {
      if (component) unmount(component)
      target.remove()
    }
  })
})
