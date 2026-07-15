import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const realmMocks = vi.hoisted(() => ({
  getRisuHub: vi.fn(),
}))

vi.mock('src/ts/characterCards', () => ({
  downloadRisuHub: vi.fn(),
  getRisuHub: realmMocks.getRisuHub,
  hubAdditionalHTML: '',
  hubURL: 'https://realm.example',
}))

vi.mock('src/ts/alert', () => ({
  alertInput: vi.fn(),
  alertNormal: vi.fn(),
}))

vi.mock('src/ts/server/resourceState.svelte', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/server/resourceState.svelte')>()
  return {
    ...actual,
    getResourceDatabase: () => ({ hideAllImages: true, language: 'en' }),
  }
})

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import RealmMain from './RealmMain.svelte'
import { MobileGUI, RealmInitialOpenChar } from 'src/ts/stores.svelte'
import type { hubType } from 'src/ts/characterCards'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function card(id: string, name: string): hubType {
  return {
    id,
    name,
    desc: `${name} description`,
    download: '',
    img: '',
    tags: [],
    viewScreen: 'none',
    hasLore: false,
    hasEmotion: false,
    hasAsset: false,
    hot: 0,
    license: '',
    type: 'character',
  }
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(target.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!match) throw new Error(`button not found: ${label}`)
  return match
}

function nextPageButton(): HTMLButtonElement {
  const match = target.querySelector<SVGElement>('svg.lucide-arrow-right')?.closest('button')
  if (!match) throw new Error('next page button not found')
  return match
}

function searchInput(): HTMLInputElement {
  const match = target.querySelector('input')
  if (!match) throw new Error('Realm search input not found')
  return match
}

function searchButton(): HTMLButtonElement {
  const match = searchInput().nextElementSibling
  if (!(match instanceof HTMLButtonElement)) throw new Error('Realm search button not found')
  return match
}

function latestQuery(): { search: string; page: number; nsfw: boolean; sort: string } {
  const call = realmMocks.getRisuHub.mock.calls.at(-1)
  if (!call) throw new Error('Realm query not found')
  return call[0]
}

let component: Parameters<typeof unmount>[0] | undefined
let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  realmMocks.getRisuHub.mockReset()
  MobileGUI.set(false)
  RealmInitialOpenChar.set(null)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  MobileGUI.set(false)
  RealmInitialOpenChar.set(null)
})

describe('RealmMain request ownership', () => {
  it('does not let an older catalog response replace the latest sort results', async () => {
    const older = deferred<hubType[]>()
    const latest = deferred<hubType[]>()
    realmMocks.getRisuHub.mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise)

    component = mount(RealmMain, { target })
    await vi.waitFor(() => expect(realmMocks.getRisuHub).toHaveBeenCalledTimes(1))

    button('Recent').click()
    await vi.waitFor(() => expect(realmMocks.getRisuHub).toHaveBeenCalledTimes(2))

    latest.resolve([card('latest', 'Latest result')])
    await tick()
    expect(target.textContent).toContain('Latest result')

    older.resolve([card('older', 'Older result')])
    await tick()
    expect(target.textContent).toContain('Latest result')
    expect(target.textContent).not.toContain('Older result')
  })
})

describe('RealmMain query pagination', () => {
  it('returns desktop search, sort, and content filters to the first page', async () => {
    realmMocks.getRisuHub.mockResolvedValue([])
    component = mount(RealmMain, { target })
    await vi.waitFor(() => expect(realmMocks.getRisuHub).toHaveBeenCalledTimes(1))

    button('Recent').click()
    await tick()
    nextPageButton().click()
    expect(latestQuery()).toMatchObject({ page: 1, sort: '' })

    button('NSFW').click()
    expect(latestQuery()).toMatchObject({ page: 0, nsfw: true, sort: '' })
    expect(button('1')).toBeTruthy()

    nextPageButton().click()
    const input = searchInput()
    input.value = 'new query'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    searchButton().click()
    expect(latestQuery()).toMatchObject({ search: 'new query', page: 0 })
    expect(button('1')).toBeTruthy()

    nextPageButton().click()
    button('Trending').click()
    expect(latestQuery()).toMatchObject({ page: 0, sort: 'trending' })
    expect(button('1')).toBeTruthy()
  })

  it('returns the mobile sort cycle to the first page', async () => {
    MobileGUI.set(true)
    realmMocks.getRisuHub.mockResolvedValue([])
    component = mount(RealmMain, { target })
    await vi.waitFor(() => expect(realmMocks.getRisuHub).toHaveBeenCalledTimes(1))

    button('Recommended').click()
    await tick()
    nextPageButton().click()
    expect(latestQuery()).toMatchObject({ page: 1, sort: '' })

    button('Recent').click()
    expect(latestQuery()).toMatchObject({ page: 0, sort: 'trending' })
    expect(button('1')).toBeTruthy()
  })
})
