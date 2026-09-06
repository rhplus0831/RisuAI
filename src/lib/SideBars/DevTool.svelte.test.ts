import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const devToolMocks = vi.hoisted(() => ({
  activeTarget: {
    selectedCharID: 0,
    chatPage: 1,
    characterId: 'character-a',
    chatId: 'chat-b',
  },
  alertError: vi.fn(),
  alertMd: vi.fn(),
  alertNormal: vi.fn(),
  beginAlertWait: vi.fn(() => Symbol('preview-wait')),
  clearAlertWait: vi.fn(() => true),
  getCharToken: vi.fn<(character: unknown) => Promise<{ persistant: number; dynamic: number }>>(async () => ({
    persistant: 0,
    dynamic: 0,
  })),
  getChatVisibleTokens: vi.fn(async () => 3),
  fetchLoreTokenCounts: vi.fn(async (_characterId: string, _chatId: string, _signal?: AbortSignal) => ({
    character: 2,
    module: 4,
    chat: 6,
    hasRandomActivation: false,
  })),
  hydrateChatMessages: vi.fn(async (_id: string, _options?: unknown) => {}),
  isTranscriptHydrated: vi.fn(() => true),
  getChatToken: vi.fn<(chat: unknown) => Promise<number>>(async () => 0),
  tokenizePreset: vi.fn(async () => 0),
  appendCurrentChatUserMessageForSend: vi.fn<(...args: any[]) => Promise<any>>(async () => ({
    status: 'ok',
    messageId: 'message-b',
  })),
  coordinateAcceptedChatSend: vi.fn<(...args: any[]) => Promise<any>>(async () => ({ status: 'generated' })),
  sendChat: vi.fn(async () => true),
  setChatScriptstateValue: vi.fn(),
}))

vi.mock('src/ts/process/index.svelte', () => ({
  previewBody: '{"chat":"b"}',
  previewFormated: [{ role: 'user', content: 'Preview for B' }],
  sendChat: devToolMocks.sendChat,
}))

vi.mock('src/ts/process/acceptedSendCoordinator.svelte', () => ({
  coordinateAcceptedChatSend: devToolMocks.coordinateAcceptedChatSend,
}))

vi.mock('src/ts/chatCommands', () => ({
  appendCurrentChatUserMessageForSend: devToolMocks.appendCurrentChatUserMessageForSend,
  captureActiveChatTarget: () => ({ ...devToolMocks.activeTarget }),
  isActiveChatTargetFresh: (target: { characterId?: string; chatId?: string }) =>
    target.characterId === devToolMocks.activeTarget.characterId && target.chatId === devToolMocks.activeTarget.chatId,
  setChatScriptstateValue: devToolMocks.setChatScriptstateValue,
}))

vi.mock('src/ts/alert', async (importActual) => ({
  ...(await importActual<typeof import('src/ts/alert')>()),
  alertError: devToolMocks.alertError,
  alertMd: devToolMocks.alertMd,
  alertNormal: devToolMocks.alertNormal,
  beginAlertWait: devToolMocks.beginAlertWait,
  clearAlertWait: devToolMocks.clearAlertWait,
}))

vi.mock('src/ts/tokenizer', () => ({
  getCharToken: devToolMocks.getCharToken,
  getChatToken: devToolMocks.getChatToken,
}))

vi.mock('src/ts/process/prompt', () => ({
  tokenizePreset: devToolMocks.tokenizePreset,
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: () => [],
  getModuleLorebooks: () => [],
  getModuleRegexScripts: () => [],
  getModules: () => [],
  getModuleTriggers: () => [],
  moduleUpdate: () => {},
}))

vi.mock('src/ts/process/lorebook.svelte', () => ({
  loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}))

vi.mock('src/ts/server/lorebookOwner.svelte', async (importActual) => ({
  ...(await importActual<typeof import('src/ts/server/lorebookOwner.svelte')>()),
  isCharacterLorebookMutationReady: () => true,
}))
vi.mock('src/ts/chatVisibleTokens', () => ({ getChatVisibleTokens: devToolMocks.getChatVisibleTokens }))
vi.mock('src/ts/server/loreTokenCounts', () => ({ fetchLoreTokenCounts: devToolMocks.fetchLoreTokenCounts }))
vi.mock('src/ts/server/routeResourceLoader', () => ({ ensureResourceSurfaces: vi.fn(async () => {}) }))
vi.mock('src/ts/server/chatMessageHydration.svelte', async (importActual) => ({
  ...(await importActual<typeof import('src/ts/server/chatMessageHydration.svelte')>()),
  hydrateChatMessages: devToolMocks.hydrateChatMessages,
  isChatMessageTranscriptHydrated: devToolMocks.isTranscriptHydrated,
}))

vi.mock('src/ts/filePicker', () => ({
  selectSingleFile: vi.fn(async () => null),
}))

import DevTool from './DevTool.svelte'
import { language } from 'src/lang'
import { selectedCharID } from 'src/ts/stores.svelte'
import { setDatabaseLite, type Database } from 'src/ts/storage/database.svelte'
import { applyServerChatMessagesResource, resetChatHydration } from 'src/ts/server/chatMessageHydration.svelte'
import {
  beginChatGenerationActivity,
  resetChatGenerationActivitiesForTests,
} from 'src/ts/process/generationActivity.svelte'
import { getDatabase } from 'src/ts/__tests__/resourceDatabaseState'

type MountedComponent = Parameters<typeof unmount>[0]

const targetA = {
  selectedCharID: 0,
  chatPage: 0,
  characterId: 'character-a',
  chatId: 'chat-a',
}

const targetB = {
  selectedCharID: 0,
  chatPage: 1,
  characterId: 'character-a',
  chatId: 'chat-b',
}

let component: MountedComponent | undefined
let target: HTMLElement

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await tick()
    await Promise.resolve()
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

async function openSection(name: string): Promise<HTMLElement> {
  const trigger = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim() === name,
  )
  expect(trigger).toBeTruthy()
  trigger!.click()
  await settle()
  const panelId = trigger!.getAttribute('aria-controls')
  const panel = panelId ? document.getElementById(panelId) : null
  expect(panel).toBeTruthy()
  return panel!
}

function runButton(panel: HTMLElement): HTMLButtonElement {
  const button = Array.from(panel.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === 'Run',
  )
  expect(button).toBeTruthy()
  return button!
}

async function addAutopilotLine(panel: HTMLElement, text: string) {
  panel.querySelector<HTMLButtonElement>(`button[aria-label="${language.add}: Autopilot"]`)!.click()
  await settle()
  const textarea = Array.from(panel.querySelectorAll<HTMLTextAreaElement>('textarea')).at(-1)
  expect(textarea).toBeTruthy()
  textarea!.value = text
  textarea!.dispatchEvent(new InputEvent('input', { bubbles: true }))
  await settle()
}

beforeEach(() => {
  resetChatGenerationActivitiesForTests()
  Object.assign(devToolMocks.activeTarget, targetB)
  for (const mock of [
    devToolMocks.alertError,
    devToolMocks.alertMd,
    devToolMocks.alertNormal,
    devToolMocks.getCharToken,
    devToolMocks.getChatToken,
    devToolMocks.setChatScriptstateValue,
    devToolMocks.tokenizePreset,
  ]) {
    mock.mockReset()
  }
  devToolMocks.beginAlertWait.mockReset().mockImplementation(() => Symbol('preview-wait'))
  devToolMocks.clearAlertWait.mockReset().mockReturnValue(true)
  devToolMocks.getCharToken.mockResolvedValue({ persistant: 0, dynamic: 0 })
  devToolMocks.getChatToken.mockResolvedValue(0)
  devToolMocks.getChatVisibleTokens.mockReset().mockResolvedValue(3)
  devToolMocks.fetchLoreTokenCounts
    .mockReset()
    .mockResolvedValue({ character: 2, module: 4, chat: 6, hasRandomActivation: false })
  devToolMocks.hydrateChatMessages.mockReset().mockResolvedValue(undefined)
  devToolMocks.isTranscriptHydrated.mockReset().mockReturnValue(true)
  devToolMocks.appendCurrentChatUserMessageForSend.mockReset().mockResolvedValue({
    status: 'ok',
    messageId: 'message-b',
  })
  devToolMocks.coordinateAcceptedChatSend.mockReset().mockResolvedValue({ status: 'generated' })
  devToolMocks.sendChat.mockReset().mockResolvedValue(true)
  selectedCharID.set(0)
  setDatabaseLite({
    currentChar: 0,
    characters: [
      {
        chaId: 'character-a',
        name: 'Character A',
        chatPage: 1,
        chats: [
          { id: 'chat-a', message: [] },
          { id: 'chat-b', message: [] },
        ],
      },
    ],
  } as unknown as Database)
  target = document.createElement('div')
  document.body.appendChild(target)
  component = mount(DevTool, { target })
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  selectedCharID.set(-1)
  setDatabaseLite({} as Database)
  resetChatHydration()
  resetChatGenerationActivitiesForTests()
})

describe('DevTool chat generation ownership', () => {
  it('runs Chat B preview and autopilot while Chat A generates', async () => {
    beginChatGenerationActivity({ target: targetA, kind: 'message' })

    const previewPanel = await openSection('Preview Prompt')
    runButton(previewPanel).click()
    await settle()

    expect(devToolMocks.sendChat).toHaveBeenCalledWith(-1, {
      preview: true,
      previewPrompt: false,
      expectedTarget: targetB,
    })
    expect(devToolMocks.beginAlertWait).toHaveBeenCalledWith('Loading...')
    expect(devToolMocks.clearAlertWait).toHaveBeenCalledOnce()
    expect(devToolMocks.alertMd).toHaveBeenCalledOnce()

    devToolMocks.sendChat.mockClear()
    const autopilotPanel = await openSection('Autopilot')
    await addAutopilotLine(autopilotPanel, 'Continue in B')
    runButton(autopilotPanel).click()
    await settle()

    expect(devToolMocks.appendCurrentChatUserMessageForSend).toHaveBeenCalledWith('Continue in B', {
      expectedTarget: targetB,
    })
    expect(devToolMocks.coordinateAcceptedChatSend).toHaveBeenCalledWith({
      target: targetB,
      append: { status: 'ok', messageId: 'message-b' },
    })
    expect(devToolMocks.sendChat).not.toHaveBeenCalled()
  })

  it('blocks Chat B preview and autopilot while Chat B generates', async () => {
    beginChatGenerationActivity({ target: targetB, kind: 'message' })

    const previewPanel = await openSection('Preview Prompt')
    runButton(previewPanel).click()
    await settle()

    const autopilotPanel = await openSection('Autopilot')
    await addAutopilotLine(autopilotPanel, 'Do not append')
    runButton(autopilotPanel).click()
    await settle()

    expect(devToolMocks.sendChat).not.toHaveBeenCalled()
    expect(devToolMocks.appendCurrentChatUserMessageForSend).not.toHaveBeenCalled()
    expect(devToolMocks.beginAlertWait).not.toHaveBeenCalled()
  })

  it('clears its loading state when the producer discards a stale preview', async () => {
    devToolMocks.sendChat.mockResolvedValueOnce(false)
    const previewPanel = await openSection('Preview Prompt')

    runButton(previewPanel).click()
    await settle()

    expect(devToolMocks.beginAlertWait).toHaveBeenCalledWith('Loading...')
    expect(devToolMocks.clearAlertWait).toHaveBeenCalledOnce()
    expect(devToolMocks.alertMd).not.toHaveBeenCalled()
  })

  it('hands an accepted append to the captured target after navigation', async () => {
    let resolveAppend!: (result: { status: 'ok'; messageId: string }) => void
    devToolMocks.appendCurrentChatUserMessageForSend.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAppend = resolve
      }),
    )
    const autopilotPanel = await openSection('Autopilot')
    await addAutopilotLine(autopilotPanel, 'Owned by B')

    runButton(autopilotPanel).click()
    await Promise.resolve()
    expect(devToolMocks.appendCurrentChatUserMessageForSend).toHaveBeenCalledWith('Owned by B', {
      expectedTarget: targetB,
    })

    Object.assign(devToolMocks.activeTarget, targetA)
    resolveAppend({ status: 'ok', messageId: 'message-b' })
    await settle()

    expect(devToolMocks.coordinateAcceptedChatSend).toHaveBeenCalledWith({
      target: targetB,
      append: { status: 'ok', messageId: 'message-b' },
    })
    expect(devToolMocks.sendChat).not.toHaveBeenCalled()
  })

  it('awaits each queued coordinator outcome before advancing autopilot', async () => {
    const appendSettlement = deferred<{ status: 'accepted' }>()
    devToolMocks.appendCurrentChatUserMessageForSend
      .mockResolvedValueOnce({
        status: 'queued',
        messageId: 'message-b-1',
        settlement: appendSettlement.promise,
      })
      .mockResolvedValueOnce({ status: 'ok', messageId: 'message-b-2' })
    devToolMocks.coordinateAcceptedChatSend
      .mockImplementationOnce(async (input: any) => {
        await input.append.settlement
        return { status: 'generated' }
      })
      .mockResolvedValueOnce({ status: 'generated' })

    const autopilotPanel = await openSection('Autopilot')
    await addAutopilotLine(autopilotPanel, 'First')
    await addAutopilotLine(autopilotPanel, 'Second')
    runButton(autopilotPanel).click()
    await settle()

    expect(devToolMocks.appendCurrentChatUserMessageForSend).toHaveBeenCalledTimes(1)
    expect(devToolMocks.coordinateAcceptedChatSend).toHaveBeenCalledWith({
      target: targetB,
      append: {
        status: 'queued',
        messageId: 'message-b-1',
        settlement: appendSettlement.promise,
      },
    })

    appendSettlement.resolve({ status: 'accepted' })
    await settle()

    expect(devToolMocks.appendCurrentChatUserMessageForSend).toHaveBeenCalledTimes(2)
    expect(devToolMocks.coordinateAcceptedChatSend).toHaveBeenCalledTimes(2)
  })

  it('stops autopilot after the current accepted item reaches recovery', async () => {
    devToolMocks.coordinateAcceptedChatSend.mockResolvedValueOnce({
      status: 'generation_failed',
      cause: 'generation_failed',
    })
    const autopilotPanel = await openSection('Autopilot')
    await addAutopilotLine(autopilotPanel, 'First')
    await addAutopilotLine(autopilotPanel, 'Do not append')

    runButton(autopilotPanel).click()
    await settle()

    expect(devToolMocks.appendCurrentChatUserMessageForSend).toHaveBeenCalledTimes(1)
    expect(devToolMocks.coordinateAcceptedChatSend).toHaveBeenCalledTimes(1)
  })

  it('counts the selected prompt owner instead of a stale flat projection', async () => {
    const canonicalTemplate = [{ id: 'canonical-row', role: 'system', content: 'canonical' }]
    setDatabaseLite({
      ...(getDatabaseSnapshot() as unknown as Record<string, unknown>),
      promptPresets: [{ id: 'prompt-a', name: 'Prompt A', promptTemplate: canonicalTemplate }],
      promptPresetsId: 0,
      promptTemplate: [{ id: 'stale-row', role: 'system', content: 'stale' }],
    } as unknown as Database)
    devToolMocks.tokenizePreset.mockClear().mockResolvedValue(7)

    await openSection('Tokens')
    await settle()

    expect(devToolMocks.tokenizePreset).toHaveBeenCalledWith(canonicalTemplate)
  })

  it('calculates only when opened and shows each category and conditional warning', async () => {
    expect(devToolMocks.fetchLoreTokenCounts).not.toHaveBeenCalled()
    expect(devToolMocks.getChatVisibleTokens).not.toHaveBeenCalled()
    devToolMocks.fetchLoreTokenCounts.mockResolvedValue({ character: 2, module: 4, chat: 6, hasRandomActivation: true })
    const panel = await openSection('Tokens')
    await settle()
    for (const label of [
      'Character Dynamic (All)',
      'Character Dynamic (Active)',
      'Module Dynamic (Active)',
      'Chat Lore (Active)',
      'Current Chat (Visible)',
    ])
      expect(panel.textContent).toContain(label)
    expect(panel.querySelector('[data-testid="token-random-warning"]')?.textContent).toContain(
      language.tokenCounts.randomWarning,
    )
    devToolMocks.fetchLoreTokenCounts.mockResolvedValue({
      character: 2,
      module: 4,
      chat: 6,
      hasRandomActivation: false,
    })
    Array.from(panel.querySelectorAll('button'))
      .find((button) => button.textContent === language.tokenCounts.recalculate)!
      .click()
    await settle()
    expect(panel.querySelector('[data-testid="token-random-warning"]')).toBeNull()
  })

  it('waits for full hydration before counting and does not display partial history as a total', async () => {
    devToolMocks.isTranscriptHydrated.mockReturnValue(false)
    const hydration = deferred<void>()
    devToolMocks.hydrateChatMessages.mockReturnValue(hydration.promise)
    const panel = await openSection('Tokens')
    expect(devToolMocks.getChatToken).not.toHaveBeenCalled()
    expect(panel.textContent).toContain(language.loading)
    devToolMocks.isTranscriptHydrated.mockReturnValue(true)
    const transcript = Array.from({ length: 40 }, (_, index) => ({
      role: 'user',
      data: `message ${index}`,
      chatId: `row-${index}`,
    }))
    applyServerChatMessagesResource('chat-b', transcript, undefined, [])
    hydration.resolve()
    await settle()
    expect(devToolMocks.getChatToken).toHaveBeenCalledWith(expect.objectContaining({ message: transcript }))
    expect(devToolMocks.getChatVisibleTokens).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message: transcript }),
      expect.any(AbortSignal),
    )
  })

  it('reports failure and supports retry instead of counting incomplete history', async () => {
    devToolMocks.isTranscriptHydrated.mockReturnValue(false)
    devToolMocks.hydrateChatMessages.mockRejectedValue(new Error('offline'))
    const panel = await openSection('Tokens')
    await settle()
    expect(devToolMocks.getChatToken).not.toHaveBeenCalled()
    expect(panel.querySelector('[role="alert"]')?.textContent).toBe(language.tokenCounts.failed)
    devToolMocks.isTranscriptHydrated.mockReturnValue(true)
    Array.from(panel.querySelectorAll('button'))
      .find((button) => button.textContent === language.retry)!
      .click()
    await settle()
    expect(devToolMocks.getChatToken).toHaveBeenCalled()
    expect(panel.querySelector('[role="alert"]')).toBeNull()
  })

  it('aborts a pending calculation when Tokens closes', async () => {
    const calculation = deferred<number>()
    devToolMocks.getChatToken.mockReturnValue(calculation.promise)
    await openSection('Tokens')
    const signal = devToolMocks.fetchLoreTokenCounts.mock.calls.at(-1)![2]!
    Array.from(target.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Tokens')!
      .click()
    await settle()
    expect(signal.aborted).toBe(true)
    calculation.resolve(999)
    await settle()
    expect(devToolMocks.getChatVisibleTokens).not.toHaveBeenCalled()
    expect(target.textContent).not.toContain('999 Tokens')
  })

  it('discards obsolete totals after a same-chat edit', async () => {
    const oldCount = deferred<number>()
    devToolMocks.getChatToken.mockReturnValueOnce(oldCount.promise).mockResolvedValue(12)
    const panel = await openSection('Tokens')
    applyServerChatMessagesResource('chat-b', [{ role: 'user', chatId: 'edited', data: 'edited body' }], undefined, [])
    await settle()
    oldCount.resolve(999)
    await settle()
    expect(panel.textContent).toContain('12 Tokens')
    expect(panel.textContent).not.toContain('999 Tokens')
    expect(devToolMocks.getChatVisibleTokens).toHaveBeenCalledTimes(1)
  })

  it('counts the canonical transcript owner instead of a divergent chat row', async () => {
    const transcript = [{ role: 'user', data: 'owned message', chatId: 'message-owned' }]
    expect(applyServerChatMessagesResource('chat-b', transcript, undefined, [])).toBe(true)
    getDatabase().characters[0].chats[1].message = [
      { role: 'user', data: 'aggregate-only', chatId: 'message-aggregate' },
    ]
    devToolMocks.getChatToken.mockClear().mockResolvedValue(5)

    await openSection('Tokens')
    await settle()

    expect(devToolMocks.getChatToken).toHaveBeenCalledOnce()
    expect(devToolMocks.getChatToken.mock.calls[0][0]).toMatchObject({
      id: 'chat-b',
      message: transcript,
    })
  })

  it('uses the ready selected-character and stable-chat owners instead of a divergent UI index', async () => {
    setDatabaseLite({
      currentChar: 0,
      characters: [
        {
          chaId: 'character-owner',
          name: 'Character Owner',
          chatPage: 0,
          chats: [{ id: 'chat-owner', message: [], scriptstate: { score: 'owner' } }],
        },
        {
          chaId: 'character-index',
          name: 'Character Index',
          chatPage: 0,
          chats: [{ id: 'chat-index', message: [], scriptstate: { score: 'index' } }],
        },
      ],
    } as unknown as Database)
    selectedCharID.set(1)
    await settle()

    const variablesPanel = await openSection('Variables')
    const scoreInput = variablesPanel.querySelector<HTMLInputElement>('input')
    expect(scoreInput?.value).toBe('owner')
    scoreInput!.value = 'updated owner'
    scoreInput!.dispatchEvent(new Event('change', { bubbles: true }))
    await openSection('Tokens')
    await settle()

    expect(devToolMocks.setChatScriptstateValue).toHaveBeenCalledWith('chat-owner', 'score', 'updated owner')
    expect(devToolMocks.getCharToken).toHaveBeenCalledWith(expect.objectContaining({ chaId: 'character-owner' }))
    expect(devToolMocks.getChatToken).toHaveBeenCalledWith(expect.objectContaining({ id: 'chat-owner' }))
  })

  it('fails closed for a duplicate selected-character owner', async () => {
    setDatabaseLite({
      currentChar: 0,
      characters: [
        {
          chaId: 'character-a',
          name: 'Character A',
          chatPage: 0,
          chats: [{ id: 'duplicate-chat', message: [], scriptstate: { score: 1 } }],
        },
        {
          chaId: 'character-a',
          name: 'Duplicate Character A',
          chatPage: 0,
          chats: [{ id: 'duplicate-chat', message: [], scriptstate: { score: 2 } }],
        },
      ],
    } as unknown as Database)
    await settle()

    const variablesPanel = await openSection('Variables')
    const tokensPanel = await openSection('Tokens')
    await settle()

    expect(variablesPanel.textContent).toContain('No variables')
    expect(devToolMocks.getCharToken).not.toHaveBeenCalled()
    expect(devToolMocks.getChatToken).not.toHaveBeenCalled()
    expect(tokensPanel.textContent).toContain('0 Tokens')
  })

  it('fails closed when a stable chat id has multiple owners', async () => {
    setDatabaseLite({
      currentChar: 0,
      characters: [
        {
          chaId: 'character-a',
          name: 'Character A',
          chatPage: 0,
          chats: [{ id: 'duplicate-chat', message: [], scriptstate: { score: 1 } }],
        },
        {
          chaId: 'character-b',
          name: 'Character B',
          chatPage: 0,
          chats: [{ id: 'duplicate-chat', message: [], scriptstate: { score: 2 } }],
        },
      ],
    } as unknown as Database)
    await settle()

    const variablesPanel = await openSection('Variables')
    await openSection('Tokens')
    await settle()

    expect(variablesPanel.textContent).toContain('No variables')
    expect(devToolMocks.getCharToken).toHaveBeenCalledWith(expect.objectContaining({ chaId: 'character-a' }))
    expect(devToolMocks.getChatToken).not.toHaveBeenCalled()
  })
})

function getDatabaseSnapshot(): Database {
  return getDatabase({ snapshot: true })
}
