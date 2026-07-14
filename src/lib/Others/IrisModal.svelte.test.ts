import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const irisMocks = vi.hoisted(() => ({
  forageGetItem: vi.fn(async () => null),
  forageSetItem: vi.fn(async () => undefined),
  requestChatData: vi.fn(),
  getToolList: vi.fn(async () => []),
}))

vi.mock('localforage', () => ({
  default: {
    createInstance: () => ({
      getItem: irisMocks.forageGetItem,
      setItem: irisMocks.forageSetItem,
    }),
  },
}))

vi.mock('src/ts/process/request/request', () => ({
  requestChatData: irisMocks.requestChatData,
}))

vi.mock('src/ts/process/mcp/risuaccess', () => ({
  RisuAccessClient: class {
    getToolList = irisMocks.getToolList
  },
}))

import IrisModal from './IrisModal.svelte'
import type { Database } from 'src/ts/storage/database.svelte'
import { replaceResourceDatabase as setDatabaseLite } from 'src/ts/server/resourceState.svelte'

const originalAnimate = Element.prototype.animate

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await tick()
    await Promise.resolve()
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => ({
      cancel: vi.fn(),
      commitStyles: vi.fn(),
      finished: Promise.resolve(),
      pause: vi.fn(),
      play: vi.fn(),
      reverse: vi.fn(),
    })),
  })
  target = document.createElement('div')
  document.body.appendChild(target)
  setDatabaseLite({
    language: 'en',
    aiModel: 'echo_model',
    subModel: 'echo_model',
    modelRoles: {
      otherAx: 'claude-3-haiku-20240307',
    },
    seperateModelsForAxModels: false,
    seperateModels: {
      memory: '',
      emotion: '',
      translate: '',
      otherAx: '',
      scriptMain: '',
      scriptAux: '',
    },
    customModels: [],
  } as unknown as Database)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  setDatabaseLite({} as Database)
  if (originalAnimate) {
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: originalAnimate,
    })
  } else {
    delete (Element.prototype as { animate?: unknown }).animate
  }
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('IrisModal model availability', () => {
  it('treats canonical otherAx overrides as available even when subModel is unsupported', async () => {
    component = mount(IrisModal, { target })
    await settle()

    expect(target.textContent).not.toContain("doesn't support me responding")
  })
})
