import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const characterSpies = vi.hoisted(() => ({
  changeChar: vi.fn(),
  getCharImage: vi.fn(() => ''),
  removeChar: vi.fn(),
}))

const characterCommandSpies = vi.hoisted(() => ({
  currentCharacterRowSnapshot: vi.fn(() => ({ snapshot: 'before-trash-restore' })),
  dispatchUpdateCharacterScoped: vi.fn(),
}))

const globalApiSpies = vi.hoisted(() => ({
  checkCharOrder: vi.fn(),
  downloadFile: vi.fn(),
  saveAsset: vi.fn(),
}))

const characterDisplaySpies = vi.hoisted(() => ({
  getCharacterDisplayInfo: vi.fn(),
}))

vi.mock('../../ts/characters', () => characterSpies)
vi.mock('src/ts/characters', () => characterSpies)
vi.mock('src/ts/characterCommands', () => characterCommandSpies)
vi.mock('src/ts/globalApi.svelte', () => globalApiSpies)
vi.mock('src/ts/characterDisplayName', async (importOriginal) => {
  const actual = await importOriginal<typeof import('src/ts/characterDisplayName')>()
  characterDisplaySpies.getCharacterDisplayInfo.mockImplementation(actual.getCharacterDisplayInfo)
  return {
    ...actual,
    getCharacterDisplayInfo: characterDisplaySpies.getCharacterDisplayInfo,
  }
})

import GridCatalog, { formatGridCatalogCharacterLists, normalizeGridCatalogSearch } from './GridCatalog.svelte'
import MobileCharacters, {
  filterMobileCharacterRows,
  formatMobileCharacterRows,
  mobileCharacterRowKey,
  normalizeMobileCharacterSearch,
} from '../Mobile/MobileCharacters.svelte'
import { MobileSearch } from 'src/ts/stores.svelte'
import {
  getResourceDatabase as getDatabase,
  replaceResourceDatabase as setDatabaseLite,
} from 'src/ts/server/resourceState.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

interface CharacterFixtureOptions {
  chaId?: string
  name: string
  displayName?: string
  image?: string
  creatorNotes?: string
  trashTime?: number
  lastInteraction?: number
  chatCount?: number
}

let target: HTMLElement
let component: MountedComponent | undefined

type GridCatalogListKind = 'simple' | 'grid' | 'list' | 'trash'

function makeCharacter(options: CharacterFixtureOptions) {
  const char: Record<string, unknown> = {
    chaId: options.chaId ?? '',
    name: options.name,
    image: options.image ?? '',
    creatorNotes: options.creatorNotes ?? 'No description',
    trashTime: options.trashTime,
    chats: Array.from({ length: options.chatCount ?? 0 }),
    lastInteraction: options.lastInteraction ?? 0,
    type: 'character',
  }
  if (options.displayName !== undefined) {
    char.displayName = options.displayName
  }
  return char
}

function seedCatalog() {
  setDatabaseLite({
    language: 'en',
    characters: [
      makeCharacter({
        chaId: 'alpha-main',
        name: 'AlphaHero',
        image: 'alpha.png',
        creatorNotes: '# `en`\nLead alpha',
      }),
      makeCharacter({
        chaId: 'trash-beta',
        name: 'Beta Backlog',
        image: 'beta.png',
        creatorNotes: '# `en`\nTrash beta',
        trashTime: 20,
      }),
      makeCharacter({
        chaId: 'alpha-side',
        name: 'Alpha Sidekick',
        image: 'side.png',
        creatorNotes: 'Side alpha',
      }),
      makeCharacter({
        chaId: 'garden',
        name: 'Garden Friend',
        image: 'garden.png',
        creatorNotes: '# `en`\nGarden',
      }),
      makeCharacter({
        chaId: 'trash-alpha',
        name: 'Trashed Alpha',
        image: 'trash-alpha.png',
        creatorNotes: '# `en`\nTrash alpha',
        trashTime: 40,
      }),
    ],
  } as any)
}

function mountCatalog() {
  component = mount(GridCatalog, { target })
}

function mountMobileCharacters(props: { hideTrash?: boolean; search?: string } = {}) {
  component = mount(MobileCharacters, { target, props })
}

function catalogRoot() {
  const root = target.querySelector<HTMLElement>('[data-risu-grid-catalog]')
  expect(root, 'grid catalog root').toBeTruthy()
  return root!
}

function catalogTab(listKind: GridCatalogListKind) {
  const tab = target.querySelector<HTMLElement>(`[data-risu-grid-tab][data-risu-list-kind="${listKind}"]`)
  expect(tab, `grid catalog tab ${listKind}`).toBeTruthy()
  return tab!
}

async function clickCatalogTab(listKind: GridCatalogListKind) {
  const button = catalogTab(listKind).querySelector<HTMLButtonElement>('button')
  expect(button, `grid catalog tab button ${listKind}`).toBeTruthy()
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
  const count = target.querySelector<HTMLElement>('[data-risu-grid-catalog-count]')
  expect(count, 'grid catalog count').toBeTruthy()
  return count?.textContent?.replace(/\s+/g, '')
}

function gridRows(listKind: GridCatalogListKind) {
  return Array.from(
    target.querySelectorAll<HTMLElement>(`[data-risu-grid-character-row][data-risu-list-kind="${listKind}"]`),
  )
}

function listHeadings(listKind: GridCatalogListKind) {
  return gridRows(listKind).map((row) => row.querySelector('[data-risu-character-name]')?.textContent?.trim())
}

function mobileRowNames() {
  return Array.from(target.querySelectorAll<HTMLElement>('[data-risu-mobile-character-row]')).map((button) =>
    button.querySelector('[data-risu-mobile-character-name]')?.textContent?.trim(),
  )
}

function rowForCharacterId(listKind: GridCatalogListKind, characterId: string) {
  const row = gridRows(listKind).find((candidate) => candidate.getAttribute('data-risu-row-id') === characterId)
  expect(row, `grid catalog ${listKind} row ${characterId}`).toBeTruthy()
  return row!
}

function gridAction(listKind: GridCatalogListKind, characterId: string, actionKind: string) {
  const action = rowForCharacterId(listKind, characterId).querySelector<HTMLButtonElement>(
    `button[data-risu-grid-action="${actionKind}"]`,
  )
  expect(action, `grid catalog ${listKind} row ${characterId} action ${actionKind}`).toBeTruthy()
  return action!
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  vi.clearAllMocks()
  MobileSearch.set('')
  seedCatalog()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  document.body.innerHTML = ''
  MobileSearch.set('')
})

describe('GridCatalog derived lists', () => {
  it('L42: GridCatalog filters active and trash lists with shared count and stable order', async () => {
    mountCatalog()
    await clickCatalogTab('grid')
    await updateSearch('AL PHA')

    expect(catalogRoot().getAttribute('data-risu-list-kind')).toBe('grid')
    expect(catalogTab('grid').getAttribute('data-risu-selected')).toBe('true')
    expect(catalogCountText()).toBe('2Character')

    await clickCatalogTab('list')
    expect(listHeadings('list')).toEqual(['AlphaHero', 'Alpha Sidekick'])
    expect(target.textContent).toContain('Lead alpha')
    expect(target.textContent).toContain('Side alpha')

    await clickCatalogTab('trash')
    expect(listHeadings('trash')).toEqual(['Trashed Alpha'])
    expect(target.textContent).toContain('Trash alpha')
  })

  it('L42: GridCatalog search recomputes formatted lists once per search edit and reuses them across tabs', async () => {
    seedCatalog()
    mountCatalog()
    await clickCatalogTab('grid')

    characterDisplaySpies.getCharacterDisplayInfo.mockClear()
    await updateSearch('alpha')
    expect(characterDisplaySpies.getCharacterDisplayInfo).toHaveBeenCalledTimes(getDatabase().characters.length)

    await updateSearch('beta')
    expect(characterDisplaySpies.getCharacterDisplayInfo).toHaveBeenCalledTimes(getDatabase().characters.length * 2)

    await clickCatalogTab('list')
    await clickCatalogTab('trash')
    expect(characterDisplaySpies.getCharacterDisplayInfo).toHaveBeenCalledTimes(getDatabase().characters.length * 2)
  })

  it('L42: GridCatalog trash actions keep restore and permanent-delete targets', async () => {
    mountCatalog()
    await clickCatalogTab('trash')

    const betaRow = rowForCharacterId('trash', 'trash-beta')
    expect(betaRow.getAttribute('data-risu-row-index')).toBe('1')
    gridAction('trash', 'trash-beta', 'restore').click()
    await tick()

    expect(getDatabase().characters[1].trashTime).toBeNull()
    expect(gridRows('trash').map((row) => row.dataset.risuRowId)).toEqual(['trash-alpha'])
    expect(characterCommandSpies.dispatchUpdateCharacterScoped).toHaveBeenCalledWith(
      'trash-beta',
      { trashTime: null },
      { snapshot: 'before-trash-restore' },
    )

    await clickCatalogTab('list')
    expect(gridRows('list').map((row) => row.dataset.risuRowId)).toContain('trash-beta')
    await clickCatalogTab('trash')
    gridAction('trash', 'trash-alpha', 'delete-permanent').click()
    await tick()

    expect(characterSpies.removeChar).toHaveBeenCalledWith(4, 'Trashed Alpha', 'permanent')
  })

  it('formats GridCatalog search by ignoring spaces, casing, trash state, and preserving order', () => {
    const lists = formatGridCatalogCharacterLists(
      {
        characters: [
          makeCharacter({ chaId: 'one', name: 'First Match' }),
          makeCharacter({ chaId: 'trash', name: 'First Trash Match', trashTime: 1 }),
          makeCharacter({ chaId: 'two', name: 'SecondMatch', displayName: '두번째' }),
          makeCharacter({ chaId: 'miss', name: 'Unrelated' }),
        ],
      } as any,
      normalizeGridCatalogSearch('second match'),
    )

    expect(lists.active.map((char) => char.name)).toEqual(['두번째'])
    expect(lists.trash.map((char) => char.name)).toEqual([])

    const localizedLists = formatGridCatalogCharacterLists(
      {
        characters: [
          makeCharacter({ chaId: 'one', name: 'First Match' }),
          makeCharacter({ chaId: 'two', name: 'SecondMatch', displayName: '두번째' }),
        ],
      } as any,
      normalizeGridCatalogSearch('두 번째'),
    )

    expect(localizedLists.active.map((char) => char.name)).toEqual(['두번째'])

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

  it('M6: MobileCharacters helper preserves sort, trash filtering, legacy keys, search, and ago text', () => {
    const now = 1_000_000_000
    const agoFormatter = {
      format: vi.fn((value: number, unit: Intl.RelativeTimeFormatUnit) => `${value}:${unit}`),
    }
    const rows = formatMobileCharacterRows(
      [
        makeCharacter({
          chaId: 'zeta',
          name: 'Zeta',
          lastInteraction: now - 3_600_000,
          chatCount: 2,
        }),
        makeCharacter({
          chaId: 'beta',
          name: 'Beta Tie',
          displayName: '베타',
          lastInteraction: now - 600_000,
        }),
        makeCharacter({
          chaId: 'trash',
          name: 'Trash Newest',
          lastInteraction: now - 60_000,
          trashTime: 1,
        }),
        makeCharacter({
          chaId: 'alpha',
          name: 'Alpha Tie',
          lastInteraction: now - 600_000,
        }),
        makeCharacter({
          chaId: '',
          name: '',
          lastInteraction: 0,
        }),
      ] as any,
      { hideTrash: true, agoFormatter, now },
    )

    expect(rows.map((char) => char.name)).toEqual(['Alpha Tie', '베타', 'Zeta', 'Unnamed'])
    expect(rows.map((char) => char.sortedIndex)).toEqual([0, 1, 2, 3])
    expect(rows.find((char) => char.name === 'Zeta')).toMatchObject({
      chats: 2,
      index: 0,
      agoText: '-1:hour',
    })
    expect(rows.find((char) => char.name === 'Unnamed')?.agoText).toBe('Unknown')
    expect(mobileCharacterRowKey(rows[3])).toBe('legacy-4')
    expect(filterMobileCharacterRows(rows, normalizeMobileCharacterSearch('AL PHA')).map((char) => char.name)).toEqual([
      'Alpha Tie',
    ])
    expect(filterMobileCharacterRows(rows, normalizeMobileCharacterSearch('beta')).map((char) => char.name)).toEqual([
      '베타',
    ])

    const rowsWithTrash = formatMobileCharacterRows(
      [
        makeCharacter({
          chaId: 'active',
          name: 'Active',
          lastInteraction: now - 600_000,
        }),
        makeCharacter({
          chaId: 'trash',
          name: 'Trash Newest',
          lastInteraction: now - 60_000,
          trashTime: 1,
        }),
      ] as any,
      { hideTrash: false, agoFormatter, now },
    )

    expect(rowsWithTrash.map((char) => char.name)).toEqual(['Trash Newest', 'Active'])
  })

  it('M6: MobileCharacters sorted rows recompute on corpus changes but not search-only changes', async () => {
    setDatabaseLite({
      language: 'en',
      characters: [
        makeCharacter({
          chaId: 'alpha-old',
          name: 'Alpha Old',
          lastInteraction: 1_000,
        }),
        makeCharacter({
          chaId: 'beta-new',
          name: 'Beta New',
          lastInteraction: 3_000,
        }),
        makeCharacter({
          chaId: 'alpha-trash',
          name: 'Alpha Trash',
          lastInteraction: 5_000,
          trashTime: 1,
        }),
      ],
    } as any)

    mountMobileCharacters({ hideTrash: true })
    await tick()
    expect(mobileRowNames()).toEqual(['Beta New', 'Alpha Old'])

    characterDisplaySpies.getCharacterDisplayInfo.mockClear()
    MobileSearch.set('AL PHA')
    await tick()
    expect(characterDisplaySpies.getCharacterDisplayInfo).not.toHaveBeenCalled()
    expect(mobileRowNames()).toEqual(['Alpha Old'])

    getDatabase().characters[0].lastInteraction = 4_000
    await tick()
    expect(characterDisplaySpies.getCharacterDisplayInfo).toHaveBeenCalledTimes(2)

    MobileSearch.set('')
    await tick()
    expect(characterDisplaySpies.getCharacterDisplayInfo).toHaveBeenCalledTimes(2)
    expect(mobileRowNames()).toEqual(['Alpha Old', 'Beta New'])
  })
})
