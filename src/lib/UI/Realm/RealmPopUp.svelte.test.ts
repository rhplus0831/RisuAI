import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const popupMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(),
  alertInput: vi.fn(),
  alertNormal: vi.fn(),
  authenticatedHubFetch: vi.fn(),
  database: {
    hideAllImages: true,
    language: 'en',
    account: {
      id: 'realm-owner',
      token: '__RISU_SECRET_MASKED__',
    },
  },
}))

vi.mock('src/ts/characterCards', () => ({
  authenticatedHubFetch: popupMocks.authenticatedHubFetch,
  downloadRisuHub: vi.fn(),
  getRealmInfo: vi.fn(),
  hubURL: '/api/v1/hub',
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: popupMocks.alertConfirm,
  alertInput: popupMocks.alertInput,
  alertNormal: popupMocks.alertNormal,
}))

vi.mock('src/ts/server/resourceState.svelte', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/server/resourceState.svelte')>()
  return {
    ...actual,
    getResourceDatabase: () => popupMocks.database,
  }
})

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import RealmPopUp from './RealmPopUp.svelte'
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

function card(id = 'realm-card'): hubType {
  return {
    id,
    name: 'Realm card',
    desc: 'Realm description',
    download: '3',
    img: '',
    tags: [],
    viewScreen: 'none',
    hasLore: false,
    hasEmotion: false,
    hasAsset: false,
    creator: 'realm-owner',
    hot: 0,
    license: '',
    type: 'character',
  }
}

function iconButton(iconClass: string): HTMLButtonElement {
  const match = target.querySelector<SVGElement>(`svg.${iconClass}`)?.closest('button')
  if (!match) throw new Error(`button not found for ${iconClass}`)
  return match
}

let component: Parameters<typeof unmount>[0] | undefined
let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  popupMocks.alertConfirm.mockReset()
  popupMocks.alertInput.mockReset()
  popupMocks.alertNormal.mockReset()
  popupMocks.authenticatedHubFetch.mockReset()
  popupMocks.authenticatedHubFetch.mockResolvedValue(new Response('removed'))
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('RealmPopUp removal ownership', () => {
  it('uses the projected account id and sends only a stable card id', async () => {
    const confirmation = deferred<boolean>()
    popupMocks.alertConfirm.mockReturnValue(confirmation.promise)
    const openedData = card('original-card')
    component = mount(RealmPopUp, { target, props: { openedData } })

    iconButton('lucide-trash').click()
    openedData.id = 'replacement-card'
    confirmation.resolve(true)

    await vi.waitFor(() => expect(popupMocks.authenticatedHubFetch).toHaveBeenCalledTimes(1))
    const [url, init] = popupMocks.authenticatedHubFetch.mock.calls[0]
    expect(url).toBe('/api/v1/hub/hub/remove')
    expect(JSON.parse(String(init.body))).toEqual({ id: 'original-card' })
    expect(JSON.parse(String(init.body))).not.toHaveProperty('token')
    await tick()
    expect(popupMocks.alertNormal).toHaveBeenCalledWith('removed')
  })
})
