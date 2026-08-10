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
  alertWait: vi.fn(),
  appendCurrentChatUserMessageForSend: vi.fn(async () => ({ status: 'ok', messageId: 'message-b' })),
  sendChat: vi.fn(async () => true),
  setChatScriptstateValue: vi.fn(),
}))

vi.mock('src/ts/process/index.svelte', () => ({
  previewBody: '{"chat":"b"}',
  previewFormated: [{ role: 'user', content: 'Preview for B' }],
  sendChat: devToolMocks.sendChat,
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
  alertWait: devToolMocks.alertWait,
}))

vi.mock('src/ts/tokenizer', () => ({
  getCharToken: vi.fn(async () => ({ persistant: 0, dynamic: 0 })),
  getChatToken: vi.fn(async () => 0),
  tokenizePreset: vi.fn(async () => 0),
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

vi.mock('src/ts/filePicker', () => ({
  selectSingleFile: vi.fn(async () => null),
}))

import DevTool from './DevTool.svelte'
import { language } from 'src/lang'
import { selectedCharID } from 'src/ts/stores.svelte'
import { setDatabaseLite, type Database } from 'src/ts/storage/database.svelte'
import {
  beginChatGenerationActivity,
  resetChatGenerationActivitiesForTests,
} from 'src/ts/process/generationActivity.svelte'

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
  const textarea = panel.querySelector<HTMLTextAreaElement>('textarea')
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
    devToolMocks.alertWait,
    devToolMocks.setChatScriptstateValue,
  ]) {
    mock.mockReset()
  }
  devToolMocks.appendCurrentChatUserMessageForSend.mockReset().mockResolvedValue({
    status: 'ok',
    messageId: 'message-b',
  })
  devToolMocks.sendChat.mockReset().mockResolvedValue(true)
  selectedCharID.set(0)
  setDatabaseLite({
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
  resetChatGenerationActivitiesForTests()
})

describe('DevTool chat generation ownership', () => {
  it('MTC-10: runs Chat B preview and autopilot while Chat A generates', async () => {
    beginChatGenerationActivity({ target: targetA, kind: 'message' })

    const previewPanel = await openSection('Preview Prompt')
    runButton(previewPanel).click()
    await settle()

    expect(devToolMocks.sendChat).toHaveBeenCalledWith(-1, {
      preview: true,
      previewPrompt: false,
      expectedTarget: targetB,
    })
    expect(devToolMocks.alertMd).toHaveBeenCalledOnce()

    devToolMocks.sendChat.mockClear()
    const autopilotPanel = await openSection('Autopilot')
    await addAutopilotLine(autopilotPanel, 'Continue in B')
    runButton(autopilotPanel).click()
    await settle()

    expect(devToolMocks.appendCurrentChatUserMessageForSend).toHaveBeenCalledWith('Continue in B', {
      expectedTarget: targetB,
    })
    expect(devToolMocks.sendChat).toHaveBeenCalledWith(0, { expectedTarget: targetB })
  })

  it('MTC-10: blocks Chat B preview and autopilot while Chat B generates', async () => {
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
    expect(devToolMocks.alertWait).not.toHaveBeenCalled()
  })

  it('does not redirect autopilot generation after navigation during append', async () => {
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

    expect(devToolMocks.sendChat).not.toHaveBeenCalled()
  })
})
