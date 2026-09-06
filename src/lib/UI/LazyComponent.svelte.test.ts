import { mount, tick, unmount } from 'svelte'
import type { Component } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { language } from 'src/lang'
import LazyComponent, { type LazyComponentLoader } from './LazyComponent.svelte'
import LazyComponentHarness from './LazyComponent.testHarness.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

async function settle(): Promise<void> {
  await tick()
  await Promise.resolve()
  await tick()
}

describe('LazyComponent', () => {
  let target: HTMLElement
  let component: MountedComponent | undefined

  beforeEach(() => {
    target = document.createElement('div')
    document.body.append(target)
  })

  afterEach(() => {
    if (component) unmount(component)
    component = undefined
    target.remove()
    vi.restoreAllMocks()
  })

  it('keeps an accessible loading surface until the component resolves', async () => {
    const loading = deferred<{ default: Component<any> }>()
    const loader: LazyComponentLoader = () => loading.promise
    component = mount(LazyComponent, { target, props: { loader, componentProps: { label: 'Ready' } } })
    await settle()

    const pending = target.querySelector('[data-testid="lazy-component-pending"]')
    const host = target.querySelector('[data-risu-lazy-surface="lazy-component"]')
    expect(pending?.getAttribute('role')).toBe('status')
    expect(pending?.getAttribute('aria-busy')).toBe('true')
    expect(host?.getAttribute('data-risu-lazy-state')).toBe('pending')
    expect(target.querySelector('[data-testid="lazy-component-loaded"]')).toBeNull()

    loading.resolve(await import('./LazyComponent.testStub.svelte'))
    await settle()

    expect(target.querySelector('[data-testid="lazy-component-pending"]')).toBeNull()
    expect(target.querySelector('[data-testid="lazy-component-loaded"]')?.textContent).toBe('Ready')
    expect(host?.getAttribute('data-risu-lazy-state')).toBe('ready')
  })

  it('shows a focused recovery action and retries after a failed load', async () => {
    const first = deferred<{ default: Component<any> }>()
    const second = deferred<{ default: Component<any> }>()
    const loader = vi.fn<LazyComponentLoader>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    component = mount(LazyComponent, { target, props: { loader } })
    await settle()

    first.reject(new Error('missing chunk'))
    await settle()

    const error = target.querySelector('[data-testid="lazy-component-error"]')
    const retry = error?.querySelector<HTMLButtonElement>('button')
    expect(error?.getAttribute('role')).toBe('alert')
    expect(document.activeElement).toBe(retry)
    expect(error?.textContent).toContain(language.preloadStaleError)
    expect(error?.querySelectorAll('button')).toHaveLength(2)

    retry?.click()
    await settle()
    expect(loader).toHaveBeenCalledTimes(2)
    expect(target.querySelector('[data-testid="lazy-component-pending"]')).not.toBeNull()

    second.resolve(await import('./LazyComponent.testStub.svelte'))
    await settle()
    expect(target.querySelector('[data-testid="lazy-component-loaded"]')).not.toBeNull()
  })

  it('captures offline state when the load fails and keeps recovery actions local', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const loader = vi.fn<LazyComponentLoader>().mockRejectedValue(new Error('offline'))
    component = mount(LazyComponent, { target, props: { loader } })
    await settle()

    const error = target.querySelector('[data-testid="lazy-component-error"]')
    const buttons = error?.querySelectorAll('button') ?? []
    expect(error?.textContent).toContain(language.preloadOfflineError)
    expect(buttons).toHaveLength(2)
    expect(buttons[0]?.textContent).toBe(language.retry)
    expect(buttons[1]?.textContent).toBe(language.preloadReload)
    expect(document.activeElement).toBe(buttons[0])
  })

  it('ignores a superseded loader failure while the current attempt remains pending', async () => {
    const first = deferred<{ default: Component<any> }>()
    const second = deferred<{ default: Component<any> }>()
    const loaders: LazyComponentLoader[] = [() => first.promise, () => second.promise]
    component = mount(LazyComponentHarness, { target, props: { loaders, testId: 'stale-attempt' } })
    await settle()
    ;(component as unknown as { selectLoader: (index: number) => void }).selectLoader(1)
    await settle()
    first.reject(new Error('superseded'))
    await settle()

    const host = target.querySelector('[data-risu-lazy-surface="stale-attempt"]')
    expect(host?.getAttribute('data-risu-lazy-state')).toBe('pending')
    expect(target.querySelector('[data-testid="stale-attempt-error"]')).toBeNull()

    second.resolve(await import('./LazyComponent.testStub.svelte'))
    await settle()
    expect(host?.getAttribute('data-risu-lazy-state')).toBe('ready')
  })

  it('preserves the original modal opener across loading and loaded focus traps', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'Open'
    document.body.insertBefore(opener, target)
    opener.focus()
    const loading = deferred<{ default: Component<any> }>()

    component = mount(LazyComponent, {
      target,
      props: { loader: () => loading.promise, modal: true, label: 'Lazy dialog' },
    })
    await settle()

    expect(opener.inert).toBe(true)
    expect(target.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true)

    loading.resolve(await import('./LazyComponent.testModalStub.svelte'))
    await settle()
    const close = target.querySelector<HTMLButtonElement>('[data-testid="lazy-modal-close"]')
    expect(document.activeElement).toBe(close)

    close?.click()
    await settle()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
