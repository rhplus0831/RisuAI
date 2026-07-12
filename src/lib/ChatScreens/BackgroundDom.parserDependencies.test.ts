import { flushSync, mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

const backgroundParserMocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  ParseMarkdown: vi.fn(async (html: string) => `markdown:${html}`),
  risuChatParser: vi.fn(
    (
      html: string,
      arg?: {
        chara?: {
          name?: string
          nickname?: string
          personality?: string
        }
      },
    ) => {
      const chara = arg?.chara
      const charName = chara?.nickname || chara?.name || ''
      return `parsed:${html.replaceAll('{{char}}', charName).replaceAll('{{personality}}', chara?.personality ?? '')}`
    },
  ),
}))

vi.mock('src/ts/parser/parser.svelte', () => ({
  ParseMarkdown: backgroundParserMocks.ParseMarkdown,
  risuChatParser: backgroundParserMocks.risuChatParser,
}))

vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: backgroundParserMocks.getDatabase,
}))

vi.mock('src/ts/process/modules', () => ({
  applyModule: vi.fn(),
  exportModule: vi.fn(),
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModuleTriggers: vi.fn(() => []),
  getModules: vi.fn(() => []),
  importModule: vi.fn(),
  moduleUpdate: vi.fn(),
  readModule: vi.fn(),
  refreshModules: vi.fn(),
}))

import BackgroundDom from './BackgroundDom.svelte'
import {
  DBState,
  ReloadGUIPointer,
  VariableReloadGUIPointer,
  moduleBackgroundEmbedding,
  selIdState,
  selectedCharID,
} from '../../ts/stores.svelte'
import {
  setServerProjectionWriteGuardEnabled,
  withTrustedServerProjectionWrite,
} from '../../ts/server/projectionWriteGuard.svelte'

backgroundParserMocks.getDatabase.mockImplementation(() => DBState.db)

type MountedComponent = Parameters<typeof unmount>[0]

const previousDb = DBState.db
const previousSelectedChar = get(selectedCharID)
const previousReloadGui = get(ReloadGUIPointer)
const previousVariableReloadGui = get(VariableReloadGUIPointer)
const previousModuleBackgroundEmbedding = get(moduleBackgroundEmbedding)

let target: HTMLElement
let component: MountedComponent | undefined

function seedDatabase(backgroundHTML = '<section>background one</section>') {
  selectedCharID.set(0)
  selIdState.selId = 0
  ReloadGUIPointer.set(0)
  VariableReloadGUIPointer.set(0)
  moduleBackgroundEmbedding.set('')
  DBState.db = {
    characters: [
      {
        backgroundHTML,
        chaId: 'background-dom-character',
        chatPage: 0,
        chats: [
          {
            id: 'background-dom-chat',
            name: 'Background Dom Chat',
            message: [
              {
                chatId: 'background-dom-message',
                data: 'visible chat text',
                role: 'char',
              },
            ],
            localLore: [],
          },
        ],
        customscript: [],
        desc: 'background description',
        emotionImages: [],
        exampleMessage: 'background example',
        hideChatIcon: false,
        image: '',
        name: 'Background Character',
        personality: 'background personality',
        scenario: 'background scenario',
        triggerscript: [],
        type: 'character',
      },
    ],
    enabledModules: [],
    moduleIntergration: '',
    modules: [],
  } as unknown as Database
  setServerProjectionWriteGuardEnabled(true)
}

async function settle() {
  flushSync()
  for (let i = 0; i < 8; i += 1) {
    await tick()
    await Promise.resolve()
  }
}

async function waitForParserCalls(count: number) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await settle()
    if (backgroundParserMocks.risuChatParser.mock.calls.length === count) {
      return
    }
  }
  expect(backgroundParserMocks.risuChatParser).toHaveBeenCalledTimes(count)
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  vi.clearAllMocks()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  setServerProjectionWriteGuardEnabled(false)
  DBState.db = previousDb
  selectedCharID.set(previousSelectedChar)
  selIdState.selId = previousSelectedChar
  ReloadGUIPointer.set(previousReloadGui)
  VariableReloadGUIPointer.set(previousVariableReloadGui)
  moduleBackgroundEmbedding.set(previousModuleBackgroundEmbedding)
  target.remove()
  document.body.innerHTML = ''
})

describe('BackgroundDom parser dependencies', () => {
  it('does not re-run background parsing on unrelated guarded projection writes', async () => {
    seedDatabase()
    component = mount(BackgroundDom, { target })
    await waitForParserCalls(1)
    expect(backgroundParserMocks.ParseMarkdown).toHaveBeenCalledTimes(1)

    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].chats[0].message[0].data = 'unrelated stream frame'
    })
    await settle()

    expect(backgroundParserMocks.risuChatParser).toHaveBeenCalledTimes(1)
    expect(backgroundParserMocks.ParseMarkdown).toHaveBeenCalledTimes(1)
  })

  it('re-runs when selected character fields used by parser callbacks change', async () => {
    seedDatabase('<section>{{char}} {{personality}}</section>')
    component = mount(BackgroundDom, { target })
    await waitForParserCalls(1)

    expect(backgroundParserMocks.ParseMarkdown.mock.calls[0][0]).toBe(
      'parsed:<section>Background Character background personality</section>\n',
    )

    backgroundParserMocks.risuChatParser.mockClear()
    backgroundParserMocks.ParseMarkdown.mockClear()

    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].personality = 'updated background personality'
    })
    await waitForParserCalls(1)

    expect(backgroundParserMocks.risuChatParser).toHaveBeenCalledTimes(1)
    expect(backgroundParserMocks.ParseMarkdown).toHaveBeenCalledTimes(1)
    expect(backgroundParserMocks.ParseMarkdown.mock.calls[0][0]).toBe(
      'parsed:<section>Background Character updated background personality</section>\n',
    )

    backgroundParserMocks.risuChatParser.mockClear()
    backgroundParserMocks.ParseMarkdown.mockClear()

    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].chats[0].message[0].data = 'unrelated stream frame after signature'
    })
    await settle()

    expect(backgroundParserMocks.risuChatParser).toHaveBeenCalledTimes(0)
    expect(backgroundParserMocks.ParseMarkdown).toHaveBeenCalledTimes(0)
  })

  it('re-runs when background, module embedding, or reload inputs change', async () => {
    seedDatabase()
    component = mount(BackgroundDom, { target })
    await waitForParserCalls(1)
    backgroundParserMocks.risuChatParser.mockClear()
    backgroundParserMocks.ParseMarkdown.mockClear()

    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].backgroundHTML = '<section>background two</section>'
    })
    await waitForParserCalls(1)

    expect(backgroundParserMocks.risuChatParser.mock.calls[0][0]).toBe('<section>background two</section>\n')
    expect(backgroundParserMocks.ParseMarkdown).toHaveBeenCalledTimes(1)

    backgroundParserMocks.risuChatParser.mockClear()
    backgroundParserMocks.ParseMarkdown.mockClear()
    moduleBackgroundEmbedding.set('<style>.background-module { color: red; }</style>')
    await waitForParserCalls(1)

    expect(backgroundParserMocks.risuChatParser.mock.calls[0][0]).toBe(
      '<section>background two</section>\n<style>.background-module { color: red; }</style>',
    )
    expect(backgroundParserMocks.ParseMarkdown).toHaveBeenCalledTimes(1)

    backgroundParserMocks.risuChatParser.mockClear()
    backgroundParserMocks.ParseMarkdown.mockClear()
    ReloadGUIPointer.update((value) => value + 1)
    await waitForParserCalls(1)

    expect(backgroundParserMocks.risuChatParser.mock.calls[0][0]).toBe(
      '<section>background two</section>\n<style>.background-module { color: red; }</style>',
    )
    expect(backgroundParserMocks.ParseMarkdown).toHaveBeenCalledTimes(1)
  })
})
