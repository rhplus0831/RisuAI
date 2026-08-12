import { afterEach, describe, expect, it, vi } from 'vitest'
import { installViewportDebugOverlay } from './viewportDebugOverlay'
import { installViewportDebugOverlayIfEnabled, isViewportDebugOverlayEnabled } from './viewportDebugOverlayGate'

class MockVisualViewport extends EventTarget {
  height = 417
  offsetTop = 23
  pageTop = 29
}

describe('viewport debug overlay gate', () => {
  const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
  let cleanup: (() => void) | undefined

  afterEach(() => {
    cleanup?.()
    cleanup = undefined
    document.body.replaceChildren()
    document.documentElement.style.removeProperty('--risu-visual-viewport-height')
    document.documentElement.removeAttribute('data-risu-visual-viewport-active')
    if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport)
    else delete (window as Window & { visualViewport?: VisualViewport }).visualViewport
    vi.useRealTimers()
  })

  it('does not load or install the overlay without either debug flag', async () => {
    const loadOverlay = vi.fn(async () => ({ installViewportDebugOverlay }))

    cleanup = await installViewportDebugOverlayIfEnabled({
      search: '?unrelated=1',
      readStoredFlag: () => null,
      loadOverlay,
    })

    expect(cleanup).toBeUndefined()
    expect(loadOverlay).not.toHaveBeenCalled()
    expect(document.querySelector('[data-risu-viewport-debug-overlay]')).toBeNull()
    expect(isViewportDebugOverlayEnabled('', () => '1')).toBe(true)
  })

  it('installs and records viewport events and focused polling when enabled', async () => {
    vi.useFakeTimers()
    const visualViewport = new MockVisualViewport()
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewport,
    })
    document.documentElement.style.setProperty('--risu-visual-viewport-height', '417px')
    document.documentElement.setAttribute('data-risu-visual-viewport-active', 'true')
    const shell = document.createElement('main')
    shell.dataset.risuVisualViewportShell = 'true'
    document.body.append(shell)

    cleanup = await installViewportDebugOverlayIfEnabled({
      search: '?risuViewportDebug=1',
      readStoredFlag: () => null,
      loadOverlay: async () => ({ installViewportDebugOverlay }),
    })

    const panel = document.querySelector<HTMLElement>('[data-risu-viewport-debug-overlay]')
    expect(panel?.parentElement).toBe(shell)
    expect(panel?.textContent).toContain('visualViewport.offsetTop: 23.0')
    expect(panel?.querySelector('input, textarea, button, [tabindex]')).toBeNull()

    const textarea = document.createElement('textarea')
    shell.append(textarea)
    textarea.focus()
    visualViewport.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(200)

    const dump = JSON.parse(window.__RISU_VIEWPORT_DEBUG_DUMP__?.() ?? '[]') as Array<{ event: string }>
    expect(dump.map((entry) => entry.event)).toEqual(
      expect.arrayContaining(['install', 'focusin', 'visualViewport.resize', 'poll']),
    )
  })
})
