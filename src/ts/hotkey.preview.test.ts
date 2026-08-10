import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const previewMocks = vi.hoisted(() => ({
  alertMd: vi.fn(),
  alertWait: vi.fn(),
  sendChat: vi.fn(async () => true),
}))

vi.mock('./process/index.svelte', () => ({
  previewBody: '{"chat":"b"}',
  sendChat: previewMocks.sendChat,
}))

vi.mock('./alert', async (importActual) => ({
  ...(await importActual<typeof import('./alert')>()),
  alertMd: previewMocks.alertMd,
  alertWait: previewMocks.alertWait,
}))

vi.mock('./process/modules', async (importActual) => {
  const actual = await importActual<typeof import('./process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import { initHotkey } from './hotkey'
import { alertStore } from './alert'
import { selectedCharID } from './stores.svelte'
import { getDatabase, setDatabaseLite, type Database } from './storage/database.svelte'
import { beginChatGenerationActivity, resetChatGenerationActivitiesForTests } from './process/generationActivity.svelte'

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

function seedPreviewHotkeyDatabase() {
  selectedCharID.set(0)
  setDatabaseLite({
    hotkeys: [{ action: 'previewRequest', ctrl: true, key: 'p' }],
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
}

async function pressPreviewHotkey() {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    key: 'p',
  })
  document.dispatchEvent(event)
  await Promise.resolve()
  await Promise.resolve()
  return event
}

beforeAll(() => {
  initHotkey()
})

beforeEach(() => {
  resetChatGenerationActivitiesForTests()
  previewMocks.alertMd.mockReset()
  previewMocks.alertWait.mockReset()
  previewMocks.sendChat.mockReset().mockResolvedValue(true)
  alertStore.set({ type: 'none', msg: '' })
  seedPreviewHotkeyDatabase()
})

describe('prompt-preview hotkey generation ownership', () => {
  it('MTC-10: previews idle Chat B while Chat A generates and passes the captured target', async () => {
    beginChatGenerationActivity({ target: targetA, kind: 'message' })

    const event = await pressPreviewHotkey()

    expect(event.defaultPrevented).toBe(true)
    expect(previewMocks.sendChat).toHaveBeenCalledOnce()
    expect(previewMocks.sendChat).toHaveBeenCalledWith(-1, {
      previewPrompt: true,
      expectedTarget: targetB,
    })
    expect(previewMocks.alertMd).toHaveBeenCalledOnce()
  })

  it('MTC-10: blocks preview when the active generation belongs to Chat B', async () => {
    beginChatGenerationActivity({ target: targetB, kind: 'message' })

    const event = await pressPreviewHotkey()

    expect(event.defaultPrevented).toBe(false)
    expect(previewMocks.sendChat).not.toHaveBeenCalled()
    expect(previewMocks.alertWait).not.toHaveBeenCalled()
  })

  it('keeps a deferred preview owned by its captured chat after navigation', async () => {
    let resolvePreview!: (generated: boolean) => void
    previewMocks.sendChat.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolvePreview = resolve
      }),
    )

    const preview = pressPreviewHotkey()
    await Promise.resolve()
    getDatabase().characters[0].chatPage = 0
    resolvePreview(true)
    await preview

    expect(previewMocks.sendChat).toHaveBeenCalledWith(-1, {
      previewPrompt: true,
      expectedTarget: targetB,
    })
    expect(previewMocks.alertMd).not.toHaveBeenCalled()
  })
})
