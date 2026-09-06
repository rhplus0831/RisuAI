import { flushSync, mount, tick, unmount } from 'svelte'
import DOMPurify from 'dompurify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedRenderCostMessages } from '../../ts/__tests__/renderCostHarness'
import { withTestDatabaseWrite } from '../../ts/__tests__/resourceDatabaseState'
import { applyCharacterResource, charactersResourceState } from '../../ts/server/resourceState.svelte'
import { applyServerChatMessagesResource, getChatMessageOwnerState } from '../../ts/server/chatMessageHydration.svelte'
import {
  beginStartupAttempt,
  completeStartupAttempt,
  recordStartupMilestone,
  resetStartupReadinessForTests,
} from '../../ts/startupReadiness'
import * as parser from '../../ts/parser/parser.svelte'
import ChatsHarness from './Chats.startupHarness.svelte'
import { invalidateModuleRenderRevision } from '../../ts/moduleRenderRevision'
import { reloadGuiDisplay } from '../../ts/stores.svelte'
import {
  beginGenerationDisplayProjection,
  resetGenerationDisplayProjectionsForTests,
} from '../../ts/process/generationDisplayProjection.svelte'
const scheduledDisplay = vi.hoisted(() => vi.fn())
vi.mock('./chatDisplayScheduler', async (importActual) => {
  const actual = await importActual<typeof import('./chatDisplayScheduler')>()
  return {
    ...actual,
    createChatDisplayScheduler: (...args: Parameters<typeof actual.createChatDisplayScheduler>) => {
      const scheduler = actual.createChatDisplayScheduler(...args)
      return {
        ...scheduler,
        run<T>(work: () => Promise<T>, signal: AbortSignal) {
          scheduledDisplay()
          return scheduler.run(work, signal)
        },
      }
    },
  }
})

vi.mock('../../ts/process/modules', async (importActual) => ({
  ...(await importActual<typeof import('../../ts/process/modules')>()),
  getModuleAssets: () => [],
  getModuleLorebooks: () => [],
  getModuleRegexScripts: () => [],
  getModuleTriggers: () => [],
  getModules: () => [],
  moduleUpdate: () => {},
}))

async function flush() {
  for (let i = 0; i < 4; i++) {
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetStartupReadinessForTests()
  resetGenerationDisplayProjectionsForTests()
  document.body.innerHTML = ''
})

describe('chat startup rendering', () => {
  it('keeps diagnostic legacy paging available beyond the ordinary residency bound', async () => {
    seedRenderCostMessages(180)
    const character = charactersResourceState.characters[0]
    const chat = character.chats[0]
    vi.spyOn(parser, 'ParseMarkdown').mockImplementation(async (html) => `<p>${html}</p>`)
    localStorage.setItem('risu-transcript-legacy-paging', '1')
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(ChatsHarness, {
      target,
      props: { chatId: chat.id, characterId: character.chaId, loadPages: 180 },
    })
    try {
      await flush()
      expect(target.querySelectorAll('.risu-chat')).toHaveLength(180)
      expect(target.querySelector('[data-transcript-residency-mode="legacy"]')).not.toBeNull()
      expect(target.querySelector('[data-transcript-spacer]')).toBeNull()
      component.setLoadPages(15)
      await flush()
      expect(target.querySelectorAll('.risu-chat')).toHaveLength(15)
    } finally {
      await unmount(component)
      localStorage.removeItem('risu-transcript-legacy-paging')
    }
  })

  it('keeps an older regeneration row through a page reduction before selecting bounded DOM residency', async () => {
    seedRenderCostMessages(180)
    const character = charactersResourceState.characters[0]
    const chat = character.chats[0]
    const messageId = chat.message[5].chatId!
    vi.spyOn(parser, 'ParseMarkdown').mockImplementation(async (html) => `<p>${html}</p>`)
    beginGenerationDisplayProjection({
      operationId: 'older-regeneration',
      attemptNo: 1,
      characterId: character.chaId,
      chatId: chat.id,
      mode: 'regenerate',
      targetMessageId: messageId,
      projectionEpoch: 1,
    })
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(ChatsHarness, {
      target,
      props: { chatId: chat.id, characterId: character.chaId, loadPages: 180 },
    })
    try {
      await flush()
      const projected = target.querySelector(`[data-risu-message-id="${messageId}"]`)
      expect(projected).not.toBeNull()
      component.setLoadPages(15)
      await flush()
      expect(target.querySelector(`[data-risu-message-id="${messageId}"]`)).toBe(projected)
      expect(target.querySelectorAll('.risu-chat').length).toBeLessThanOrEqual(76)
      resetGenerationDisplayProjectionsForTests()
      await flush()
      expect(target.querySelectorAll('.risu-chat')).toHaveLength(15)
    } finally {
      await unmount(component)
    }
  })

  it('retains rendered body nodes during reloads and discards superseded parse results', async () => {
    seedRenderCostMessages(2)
    const character = charactersResourceState.characters[0]
    const chat = character.chats[0]
    const parse = vi.spyOn(parser, 'ParseMarkdown').mockImplementation(async (html) => `<p>${html}</p>`)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(ChatsHarness, { target, props: { chatId: chat.id, characterId: character.chaId } })
    const pending: Array<(html: string) => void> = []
    try {
      await flush()
      const bodies = [...target.querySelectorAll('.chat-message-body p')]
      expect(bodies).toHaveLength(2)
      parse.mockImplementation(() => new Promise((resolve) => pending.push(resolve)))

      invalidateModuleRenderRevision()
      await flush()
      expect(pending).toHaveLength(2)
      expect([...target.querySelectorAll('.chat-message-body p')]).toEqual(bodies)
      for (const message of chat.message) expect(target.textContent).toContain(message.data)

      reloadGuiDisplay()
      await flush()
      expect(pending).toHaveLength(4)
      expect([...target.querySelectorAll('.chat-message-body p')]).toEqual(bodies)
      pending.slice(2).forEach((resolve) => resolve('<p>Current display result</p>'))
      await flush()
      expect(target.querySelectorAll('.chat-message-body p')).toHaveLength(2)
      expect(target.textContent).toContain('Current display result')

      pending.slice(0, 2).forEach((resolve) => resolve('<p>Superseded display result</p>'))
      await flush()
      expect(target.textContent).not.toContain('Superseded display result')
      expect(target.textContent).toContain('Current display result')
    } finally {
      pending.forEach((resolve) => resolve(''))
      await unmount(component)
    }
  })

  it('keeps all rows mounted, progressively parses older bodies, and ignores unrelated character hydration', async () => {
    resetStartupReadinessForTests()
    const startupAttempt = beginStartupAttempt()
    const callbacks = new Map<number, IdleRequestCallback>()
    let nextId = 0
    vi.stubGlobal('requestIdleCallback', (run: IdleRequestCallback) => {
      const id = ++nextId
      callbacks.set(id, run)
      return id
    })
    vi.stubGlobal('cancelIdleCallback', (id: number) => callbacks.delete(id))
    const frame = async () => {
      const current = [...callbacks.values()]
      callbacks.clear()
      current.forEach((run) => run({ didTimeout: false, timeRemaining: () => 10 }))
      await flush()
    }
    seedRenderCostMessages(6)
    const character = charactersResourceState.characters[0]
    const chat = character.chats[0]
    withTestDatabaseWrite(() => {
      charactersResourceState.characters.push({
        ...character,
        chaId: 'background-character',
        chats: [],
      })
    })
    const parse = vi.spyOn(parser, 'ParseMarkdown').mockImplementation(async (html) => `<p>${html}</p>`)
    const sanitize = vi.spyOn(DOMPurify, 'sanitize')
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(ChatsHarness, { target, props: { chatId: chat.id, characterId: character.chaId } })
    try {
      flushSync()
      await flush()
      expect(target.querySelectorAll('.risu-chat')).toHaveLength(6)
      expect(parse).toHaveBeenCalledTimes(2)
      expect(target.textContent).toContain(chat.message[5].data)
      expect(target.textContent).not.toContain(chat.message[0].data)
      await frame()
      expect(parse).toHaveBeenCalledTimes(2)
      recordStartupMilestone('background-ready')
      completeStartupAttempt(startupAttempt)
      await flush()
      for (let count = 3; count <= 6; count++) {
        await frame()
        expect(parse).toHaveBeenCalledTimes(count)
      }
      for (const message of chat.message) expect(target.textContent).toContain(message.data)

      parse.mockClear()
      sanitize.mockClear()
      scheduledDisplay.mockClear()
      withTestDatabaseWrite(() => {
        applyCharacterResource({
          revision: 1,
          character: {
            ...charactersResourceState.characters[1],
            name: 'Hydrated background',
            desc: 'Unrelated detail',
          },
        })
      })
      await flush()
      await frame()
      expect(parse).not.toHaveBeenCalled()
      expect(sanitize).not.toHaveBeenCalled()
      expect(scheduledDisplay).not.toHaveBeenCalled()

      expect(
        applyServerChatMessagesResource(
          chat.id,
          getChatMessageOwnerState(chat.id)!.messages.map((message, index) =>
            index === 0 ? { ...message, data: 'Edited older message' } : message,
          ),
          undefined,
          [],
        ),
      ).toBe(true)
      expect(getChatMessageOwnerState(chat.id)!.messages[0].data).toBe('Edited older message')
      await flush()
      await frame()
      await frame()
      expect(parse).toHaveBeenCalledTimes(1)
      expect(scheduledDisplay).toHaveBeenCalledTimes(1)
      expect(target.textContent).toContain('Edited older message')
    } finally {
      await unmount(component)
    }
  })
})
