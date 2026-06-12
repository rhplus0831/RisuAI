import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PartialEditController from './PartialEditController.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

interface HoverFixture {
  bodyRoot: HTMLElement
  block: HTMLElement
}

const mountedComponents: MountedComponent[] = []
let rafHarness: ReturnType<typeof stubAnimationFrame>

class VisibleIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null
  readonly rootMargin = '300px'
  readonly thresholds: ReadonlyArray<number> = [0]

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element) {
    const rect = target.getBoundingClientRect()
    this.callback(
      [
        {
          boundingClientRect: rect,
          intersectionRatio: 1,
          intersectionRect: rect,
          isIntersecting: true,
          rootBounds: null,
          target,
          time: 0,
        } as IntersectionObserverEntry,
      ],
      this,
    )
  }

  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect
}

function setRect(element: HTMLElement, left: number, top: number, width: number, height: number) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => domRect(left, top, width, height),
  })
}

function stubAnimationFrame() {
  const callbacks = new Map<number, FrameRequestCallback>()
  let nextId = 0

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextId += 1
    callbacks.set(nextId, callback)
    return nextId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    callbacks.delete(id)
  })

  return {
    flush() {
      const queued = [...callbacks.entries()]
      callbacks.clear()
      for (const [id, callback] of queued) {
        callback(id)
      }
    },
    pendingCount() {
      return callbacks.size
    },
  }
}

function createHoverFixture(options: {
  text: string
  left: number
  top: number
  width: number
  height: number
}): HoverFixture {
  const bodyRoot = document.createElement('div')
  const block = document.createElement('p')
  block.textContent = options.text
  bodyRoot.appendChild(block)
  document.body.appendChild(bodyRoot)

  setRect(bodyRoot, options.left, options.top, options.width, options.height)
  setRect(block, options.left, options.top, options.width, options.height)

  return { bodyRoot, block }
}

function stubElementFromPoint(fixtures: HoverFixture[]) {
  vi.spyOn(document, 'elementFromPoint').mockImplementation((x: number, y: number) => {
    for (const fixture of fixtures) {
      const rect = fixture.block.getBoundingClientRect()
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return fixture.block
      }
    }
    return null
  })
}

function mountController(bodyRoot: HTMLElement): MountedComponent {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const component = mount(PartialEditController, {
    target,
    props: {
      messageData: 'partial edit shared hover body',
      chatIndex: 0,
      bodyRoot,
      blockEditEnabled: true,
      dragEditEnabled: false,
    },
  })
  mountedComponents.push(component)
  return component
}

function unmountController(component: MountedComponent) {
  const index = mountedComponents.indexOf(component)
  if (index >= 0) {
    mountedComponents.splice(index, 1)
  }
  unmount(component)
}

async function settleEffects() {
  for (let i = 0; i < 4; i += 1) {
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function flushHoverFrame() {
  rafHarness.flush()
  await tick()
}

function movePointer(clientX: number, clientY: number) {
  document.dispatchEvent(
    new MouseEvent('mousemove', {
      clientX,
      clientY,
      bubbles: true,
    }),
  )
}

function getBlockButtonWrapper(): HTMLDivElement {
  const wrapper = document.querySelector('.partial-edit-btn-wrapper') as HTMLDivElement | null
  expect(wrapper).not.toBeNull()
  return wrapper!
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver)
  rafHarness = stubAnimationFrame()
})

afterEach(() => {
  while (mountedComponents.length > 0) {
    unmount(mountedComponents.pop()!)
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('PartialEditController shared hover handler', () => {
  it('L41: visible partial edit controllers share one document mousemove listener and remove it after unmount', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const first = createHoverFixture({
      text: 'first visible body',
      left: 10,
      top: 80,
      width: 160,
      height: 42,
    })
    const second = createHoverFixture({
      text: 'second visible body',
      left: 10,
      top: 150,
      width: 160,
      height: 42,
    })

    const firstController = mountController(first.bodyRoot)
    const secondController = mountController(second.bodyRoot)
    await settleEffects()

    const mouseMoveAdds = () => addSpy.mock.calls.filter(([type]) => type === 'mousemove')
    const mouseMoveRemoves = () => removeSpy.mock.calls.filter(([type]) => type === 'mousemove')

    expect(mouseMoveAdds()).toHaveLength(1)
    expect(new Set(mouseMoveAdds().map(([, listener]) => listener)).size).toBe(1)

    movePointer(300, 300)
    expect(rafHarness.pendingCount()).toBe(1)

    unmountController(firstController)
    await settleEffects()

    expect(mouseMoveRemoves()).toHaveLength(0)
    expect(rafHarness.pendingCount()).toBe(1)

    unmountController(secondController)
    await settleEffects()

    expect(mouseMoveRemoves()).toHaveLength(1)
    expect(mouseMoveRemoves()[0][1]).toBe(mouseMoveAdds()[0][1])
    expect(rafHarness.pendingCount()).toBe(0)
  })

  it('L41: shared hover keeps button zone reachability and hides on leave or scroll', async () => {
    const fixture = createHoverFixture({
      text: 'hoverable block text',
      left: 20,
      top: 80,
      width: 180,
      height: 48,
    })
    stubElementFromPoint([fixture])
    mountController(fixture.bodyRoot)
    await settleEffects()

    movePointer(40, 96)
    await flushHoverFrame()

    const wrapper = getBlockButtonWrapper()
    expect(wrapper.style.display).toBe('flex')
    expect(wrapper.style.left).toBe('20px')

    movePointer(40, 76)
    await flushHoverFrame()
    expect(wrapper.style.display).toBe('flex')

    document.dispatchEvent(new Event('scroll'))
    expect(wrapper.style.display).toBe('none')

    movePointer(40, 96)
    await flushHoverFrame()
    expect(wrapper.style.display).toBe('flex')

    fixture.bodyRoot.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: null }))
    expect(wrapper.style.display).toBe('none')
  })

  it('L41: shared hover suppresses the block button during text selection', async () => {
    const fixture = createHoverFixture({
      text: 'selected block text',
      left: 30,
      top: 90,
      width: 180,
      height: 48,
    })
    stubElementFromPoint([fixture])
    mountController(fixture.bodyRoot)
    await settleEffects()

    movePointer(50, 100)
    await flushHoverFrame()

    const wrapper = getBlockButtonWrapper()
    expect(wrapper.style.display).toBe('flex')

    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection)
    movePointer(50, 100)

    expect(wrapper.style.display).toBe('none')
    expect(rafHarness.pendingCount()).toBe(0)
  })
})
