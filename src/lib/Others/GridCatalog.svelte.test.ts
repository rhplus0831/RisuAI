import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const characterSpies = vi.hoisted(() => ({
  changeChar: vi.fn(),
  getCharImage: vi.fn(() => ''),
  removeChar: vi.fn(),
}))

const characterCommandSpies = vi.hoisted(() => ({
  currentCharacterStateSnapshot: vi.fn(() => ({ snapshot: 'before-trash-restore' })),
  dispatchUpdateCharacter: vi.fn(),
}))

const commandSpies = vi.hoisted(() => ({
  canUseServerCommands: vi.fn(() => false),
}))

const globalApiSpies = vi.hoisted(() => ({
  checkCharOrder: vi.fn(),
  downloadFile: vi.fn(),
  saveAsset: vi.fn(),
}))

vi.mock('../../ts/characters', () => characterSpies)
vi.mock('src/ts/characters', () => characterSpies)
vi.mock('src/ts/characterCommands', () => characterCommandSpies)
vi.mock('src/ts/server/commands', () => commandSpies)
vi.mock('src/ts/globalApi.svelte', () => globalApiSpies)

import GridCatalog, {
  formatGridCatalogCharacterLists,
  normalizeGridCatalogSearch,
} from './GridCatalog.svelte'
import { DBState } from 'src/ts/stores.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

interface NameReadCounter {
  count: number
}

interface CharacterFixtureOptions {
  chaId?: string
  name: string
  image?: string
  creatorNotes?: string
  trashTime?: number
  readCounter?: NameReadCounter
}

let target: HTMLElement
let component: MountedComponent | undefined

function makeCharacter(options: CharacterFixtureOptions) {
  let currentName = options.name
  const char: Record<string, unknown> = {
    chaId: options.chaId ?? '',
    image: options.image ?? '',
    creatorNotes: options.creatorNotes ?? 'No description',
    trashTime: options.trashTime,
    chats: [],
    lastInteraction: 0,
    type: 'character',
  }
  Object.defineProperty(char, 'name', {
    configurable: true,
    enumerable: true,
    get() {
      options.readCounter && (options.readCounter.count += 1)
      return currentName
    },
    set(value: string) {
      currentName = value
    },
  })
  return char
}

function seedCatalog(readCounter?: NameReadCounter) {
  DBState.db = {
    language: 'en',
    characters: [
      makeCharacter({
        chaId: 'alpha-main',
        name: 'AlphaHero',
        image: 'alpha.png',
        creatorNotes: '# `en`\nLead alpha',
        readCounter,
      }),
      makeCharacter({
        chaId: 'trash-beta',
        name: 'Beta Backlog',
        image: 'beta.png',
        creatorNotes: '# `en`\nTrash beta',
        trashTime: 20,
        readCounter,
      }),
      makeCharacter({
        chaId: 'alpha-side',
        name: 'Alpha Sidekick',
        image: 'side.png',
        creatorNotes: 'Side alpha',
        readCounter,
      }),
      makeCharacter({
        chaId: 'garden',
        name: 'Garden Friend',
        image: 'garden.png',
        creatorNotes: '# `en`\nGarden',
        readCounter,
      }),
      makeCharacter({
        chaId: 'trash-alpha',
        name: 'Trashed Alpha',
        image: 'trash-alpha.png',
        creatorNotes: '# `en`\nTrash alpha',
        trashTime: 40,
        readCounter,
      }),
    ],
  } as any
}

function mountCatalog() {
  component = mount(GridCatalog, { target })
}

async function clickButton(label: string) {
  const button = Array.from(target.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  expect(button, `button ${label}`).toBeTruthy()
  button!.click()
  await tick()
}

async function updateSearch(value: string) {
  const input = target.querySelector('input[placeholder="Search"]') as HTMLInputElement | null
  expect(input).toBeTruthy()
  input!.value = value
  input!.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
}

function catalogCountText() {
  const count = Array.from(target.querySelectorAll('span.text-textcolor2.text-sm')).find((span) =>
    span.textContent?.includes('Character'),
  )
  return count?.textContent?.replace(/\s+/g, '')
}

function listHeadings() {
  return Array.from(target.querySelectorAll('h4')).map((heading) => heading.textContent?.trim())
}

function rowForHeading(name: string) {
  const heading = Array.from(target.querySelectorAll('h4')).find(
    (candidate) => candidate.textContent?.trim() === name,
  )
  expect(heading, `row heading ${name}`).toBeTruthy()
  return heading!.closest('div.flex.p-2') as HTMLElement
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  vi.clearAllMocks()
  seedCatalog()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  document.body.innerHTML = ''
})

describe('GridCatalog derived lists', () => {
  it('L42: GridCatalog filters active and trash lists with shared count and stable order', async () => {
    mountCatalog()
    await clickButton('Grid')
    await updateSearch('AL PHA')

    expect(catalogCountText()).toBe('2Character')

    await clickButton('List')
    expect(listHeadings()).toEqual(['AlphaHero', 'Alpha Sidekick'])
    expect(target.textContent).toContain('Lead alpha')
    expect(target.textContent).toContain('Side alpha')

    await clickButton('Trash')
    expect(listHeadings()).toEqual(['Trashed Alpha'])
    expect(target.textContent).toContain('Trash alpha')
  })

  it('L42: GridCatalog search recomputes formatted lists once per search edit and reuses them across tabs', async () => {
    const readCounter = { count: 0 }
    seedCatalog(readCounter)
    mountCatalog()
    await clickButton('Grid')

    readCounter.count = 0
    await updateSearch('alpha')
    expect(readCounter.count).toBe(DBState.db.characters.length)

    await updateSearch('beta')
    expect(readCounter.count).toBe(DBState.db.characters.length * 2)

    await clickButton('List')
    await clickButton('Trash')
    expect(readCounter.count).toBe(DBState.db.characters.length * 2)
  })

  it('L42: GridCatalog trash actions keep restore and permanent-delete targets', async () => {
    mountCatalog()
    await clickButton('Trash')

    const betaRow = rowForHeading('Beta Backlog')
    const [, restoreBeta] = Array.from(betaRow.querySelectorAll('button'))
    restoreBeta.click()
    await tick()

    expect(globalApiSpies.checkCharOrder).toHaveBeenCalledOnce()
    expect(DBState.db.characters[1].trashTime).toBeUndefined()
    expect(characterCommandSpies.dispatchUpdateCharacter).toHaveBeenCalledWith(
      'trash-beta',
      { trashTime: null },
      { snapshot: 'before-trash-restore' },
    )

    await clickButton('Trash')
    const alphaRow = rowForHeading('Trashed Alpha')
    const [, , deleteAlpha] = Array.from(alphaRow.querySelectorAll('button'))
    deleteAlpha.click()
    await tick()

    expect(characterSpies.removeChar).toHaveBeenCalledWith(4, 'Trashed Alpha', 'permanent')
  })

  it('formats GridCatalog search by ignoring spaces, casing, trash state, and preserving order', () => {
    const lists = formatGridCatalogCharacterLists(
      {
        characters: [
          makeCharacter({ chaId: 'one', name: 'First Match' }),
          makeCharacter({ chaId: 'trash', name: 'First Trash Match', trashTime: 1 }),
          makeCharacter({ chaId: 'two', name: 'SecondMatch' }),
          makeCharacter({ chaId: 'miss', name: 'Unrelated' }),
        ],
      } as any,
      normalizeGridCatalogSearch('second match'),
    )

    expect(lists.active.map((char) => char.name)).toEqual(['SecondMatch'])
    expect(lists.trash.map((char) => char.name)).toEqual([])

    const trashLists = formatGridCatalogCharacterLists(
      {
        characters: [
          makeCharacter({ chaId: 'one', name: 'First Match' }),
          makeCharacter({ chaId: 'trash', name: 'First Trash Match', trashTime: 1 }),
          makeCharacter({ chaId: 'two', name: 'Second Match' }),
        ],
      } as any,
      normalizeGridCatalogSearch('FIRST'),
    )

    expect(trashLists.active.map((char) => char.name)).toEqual(['First Match'])
    expect(trashLists.trash.map((char) => char.name)).toEqual(['First Trash Match'])
  })
})
