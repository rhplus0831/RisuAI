import { flushSync, mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

const backgroundParserMocks = vi.hoisted(() => ({
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
  reapplyPendingPresetProjections: () => {},
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
import { charactersResourceState, replaceResourceDatabase } from '../../ts/server/resourceState.svelte'
import {
  ReloadGUIPointer,
  VariableReloadGUIPointer,
  moduleBackgroundEmbedding,
  selIdState,
  selectedCharID,
} from '../../ts/stores.svelte'
import { RegexDisplayReloadPointer } from '../../ts/process/regexDisplayReload'
import { getResourceDatabase, withTestDatabaseWrite } from 'src/ts/__tests__/resourceDatabaseState'

type MountedComponent = Parameters<typeof unmount>[0]

const previousDb = getResourceDatabase({ snapshot: true })
const previousSelectedChar = get(selectedCharID)
const previousReloadGui = get(ReloadGUIPointer)
const previousVariableReloadGui = get(VariableReloadGUIPointer)
const previousRegexDisplayReload = get(RegexDisplayReloadPointer)
const previousModuleBackgroundEmbedding = get(moduleBackgroundEmbedding)

let target: HTMLElement
let component: MountedComponent | undefined

function seedDatabase(backgroundHTML = '<section>background one</section>') {
  selectedCharID.set(0)
  selIdState.selId = 0
  ReloadGUIPointer.set(0)
  VariableReloadGUIPointer.set(0)
  RegexDisplayReloadPointer.set(0)
  moduleBackgroundEmbedding.set('')
  replaceResourceDatabase({
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
    currentChar: 0,
    enabledModules: [],
    moduleIntergration: '',
    modules: [],
  } as unknown as Database)
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
  replaceResourceDatabase(previousDb)
  selectedCharID.set(previousSelectedChar)
  selIdState.selId = previousSelectedChar
  ReloadGUIPointer.set(previousReloadGui)
  VariableReloadGUIPointer.set(previousVariableReloadGui)
  RegexDisplayReloadPointer.set(previousRegexDisplayReload)
  moduleBackgroundEmbedding.set(previousModuleBackgroundEmbedding)
  target.remove()
  document.body.innerHTML = ''
})

describe('BackgroundDom parser dependencies', () => {
  it('fails closed when a ready projection has no selected owner', async () => {
    seedDatabase()
    charactersResourceState.currentChar = 99
    component = mount(BackgroundDom, { target })
    await settle()

    expect(backgroundParserMocks.risuChatParser).not.toHaveBeenCalled()
    expect(target.textContent).toBe('')
  })

  it('fails closed when a ready projection has duplicate selected owners', async () => {
    seedDatabase()
    charactersResourceState.characters = [
      charactersResourceState.characters[0],
      { ...charactersResourceState.characters[0] },
    ]
    component = mount(BackgroundDom, { target })
    await settle()

    expect(backgroundParserMocks.risuChatParser).not.toHaveBeenCalled()
    expect(target.textContent).toBe('')
  })

  it('fails closed when the character owner or selected row enters error', async () => {
    seedDatabase()
    charactersResourceState.status = 'error'
    component = mount(BackgroundDom, { target })
    await settle()

    expect(backgroundParserMocks.risuChatParser).not.toHaveBeenCalled()
    expect(target.textContent).toBe('')

    unmount(component)
    component = undefined
    seedDatabase()
    charactersResourceState.rowStatuses['background-dom-character'] = 'error'
    component = mount(BackgroundDom, { target })
    await settle()

    expect(backgroundParserMocks.risuChatParser).not.toHaveBeenCalled()
    expect(target.textContent).toBe('')
  })

  it('does not re-run background parsing on unrelated owner writes', async () => {
    seedDatabase()
    component = mount(BackgroundDom, { target })
    await waitForParserCalls(1)
    expect(backgroundParserMocks.ParseMarkdown).toHaveBeenCalledTimes(1)

    withTestDatabaseWrite(() => {
      getResourceDatabase().characters[0].chats[0].message[0].data = 'unrelated stream frame'
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

    withTestDatabaseWrite(() => {
      getResourceDatabase().characters[0].personality = 'updated background personality'
    })
    await waitForParserCalls(1)

    expect(backgroundParserMocks.risuChatParser).toHaveBeenCalledTimes(1)
    expect(backgroundParserMocks.ParseMarkdown).toHaveBeenCalledTimes(1)
    expect(backgroundParserMocks.ParseMarkdown.mock.calls[0][0]).toBe(
      'parsed:<section>Background Character updated background personality</section>\n',
    )

    backgroundParserMocks.risuChatParser.mockClear()
    backgroundParserMocks.ParseMarkdown.mockClear()

    withTestDatabaseWrite(() => {
      getResourceDatabase().characters[0].chats[0].message[0].data = 'unrelated stream frame after signature'
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

    withTestDatabaseWrite(() => {
      getResourceDatabase().characters[0].backgroundHTML = '<section>background two</section>'
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

  it('defers background regex reparsing until the display activation epoch advances', async () => {
    seedDatabase()
    component = mount(BackgroundDom, { target })
    await waitForParserCalls(1)
    backgroundParserMocks.risuChatParser.mockClear()
    backgroundParserMocks.ParseMarkdown.mockClear()

    withTestDatabaseWrite(() => {
      getResourceDatabase().characters[0].customscript = [
        {
          id: 'background-display-script',
          comment: 'Background display script',
          in: 'background',
          out: 'delayed',
          type: 'editdisplay',
        },
      ]
    })
    await settle()

    expect(backgroundParserMocks.risuChatParser).not.toHaveBeenCalled()
    expect(backgroundParserMocks.ParseMarkdown).not.toHaveBeenCalled()

    RegexDisplayReloadPointer.update((value) => value + 1)
    await waitForParserCalls(1)

    expect(backgroundParserMocks.ParseMarkdown).toHaveBeenCalledOnce()
  })

  it('keeps the rendered background visible while a same-character reparse is pending', async () => {
    seedDatabase()
    component = mount(BackgroundDom, { target })
    await waitForParserCalls(1)
    expect(target.textContent).toContain('markdown:parsed:background one')

    let resolveReparse: ((value: string) => void) | undefined
    backgroundParserMocks.ParseMarkdown.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveReparse = resolve
        }),
    )

    ReloadGUIPointer.update((value) => value + 1)
    await waitForParserCalls(2)

    expect(resolveReparse).toBeTypeOf('function')
    expect(target.textContent).toContain('markdown:parsed:background one')

    resolveReparse?.('markdown:<section>background after chat selection</section>')
    await settle()

    expect(target.textContent).toContain('markdown:background after chat selection')
    expect(target.textContent).not.toContain('background one')
  })
})
