import { get, type Writable } from 'svelte/store'
import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigationMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}))

vi.mock('src/ts/router', () => ({
  characterRoutePath: (characterId: string, chatId?: string) =>
    chatId ? `/character/${characterId}/${chatId}` : `/character/${characterId}`,
  navigate: navigationMocks.navigate,
  openGridRoute: vi.fn(),
}))

vi.mock('src/ts/stores.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    OpenRealmStore: writable(true),
    PlaygroundStore: writable(4),
    SizeStore: writable({ h: 720, w: 1280 }),
  }
})

vi.mock('src/ts/server/resourceState.svelte', () => ({
  getResourceDatabase: () => ({ doNotWarnExternalServers: true }),
}))

vi.mock('src/ts/characters', () => ({
  getCharImage: vi.fn(async () => '/none.webp'),
}))

vi.mock('src/ts/process/generationActivity.svelte', async () => {
  const { writable } = await import('svelte/store')
  return { activeChatGenerations: writable([]) }
})

vi.mock('src/ts/process/reattach', async () => {
  const { writable } = await import('svelte/store')
  return {
    activeGenerationJobs: writable([]),
    generationJobLifecycles: writable({}),
  }
})

vi.mock('src/ts/process/chatUnread.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    unreadChatIds: writable(new Set()),
    markChatRead: vi.fn(),
  }
})

vi.mock('src/ts/globalApi.svelte', () => ({
  getVersionString: () => 'test-version',
  openURL: vi.fn(),
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: vi.fn(async () => true),
}))

vi.mock('../UI/Realm/RealmMain.svelte', () => ({ default: () => {} }))
vi.mock('../UI/Title.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundDocs.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundEmbedding.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundImageGen.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundImageTrans.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundInlayExplorer.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundJinja.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundMCP.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundParser.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundSubtitle.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundSyntax.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundTokenizer.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundTranslation.svelte', () => ({ default: () => {} }))
vi.mock('./ToolConversion.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { OpenRealmStore, PlaygroundStore } from 'src/ts/stores.svelte'
import MainMenu from '../UI/MainMenu.svelte'
import PlaygroundMenu from './PlaygroundMenu.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  navigationMocks.navigate.mockReset()
  ;(PlaygroundStore as Writable<number>).set(4)
  ;(OpenRealmStore as Writable<boolean>).set(true)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('Playground and main-menu navigation', () => {
  it('names the Playground icon-only back control and preserves navigation', () => {
    component = mount(PlaygroundMenu, { target })

    const back = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.goback}"]`)
    expect(back).toBeTruthy()
    expect(back?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    back!.click()
    expect(navigationMocks.navigate).toHaveBeenCalledWith('/playground')
  })

  it('names the Realm icon-only back control and preserves its store transition', () => {
    component = mount(MainMenu, { target })

    const back = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.goback}"]`)
    expect(back).toBeTruthy()
    expect(back?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    back!.click()
    expect(get(OpenRealmStore)).toBe(false)
  })

  it('keeps repository links off the main menu', () => {
    ;(OpenRealmStore as Writable<boolean>).set(false)
    component = mount(MainMenu, { target })

    expect(target.textContent).toContain(language.openRisuRealm)
    expect(target.querySelector('a[href*="github.com"]')).toBeNull()
    expect(target.textContent).not.toContain('Upstream project this variant is derived from.')
  })
})
