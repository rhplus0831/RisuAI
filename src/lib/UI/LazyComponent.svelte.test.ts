import { mount, tick, unmount } from 'svelte'
import type { Component } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LazyComponent, { type LazyComponentLoader } from './LazyComponent.svelte'

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
  })

  it('keeps an accessible loading surface until the component resolves', async () => {
    const loading = deferred<{ default: Component<any> }>()
    const loader: LazyComponentLoader = () => loading.promise
    component = mount(LazyComponent, { target, props: { loader, componentProps: { label: 'Ready' } } })
    await settle()

    const pending = target.querySelector('[data-testid="lazy-component-pending"]')
    expect(pending?.getAttribute('role')).toBe('status')
    expect(pending?.getAttribute('aria-busy')).toBe('true')
    expect(target.querySelector('[data-testid="lazy-component-loaded"]')).toBeNull()

    loading.resolve(await import('./LazyComponent.testStub.svelte'))
    await settle()

    expect(target.querySelector('[data-testid="lazy-component-pending"]')).toBeNull()
    expect(target.querySelector('[data-testid="lazy-component-loaded"]')?.textContent).toBe('Ready')
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

    retry?.click()
    await settle()
    expect(loader).toHaveBeenCalledTimes(2)
    expect(target.querySelector('[data-testid="lazy-component-pending"]')).not.toBeNull()

    second.resolve(await import('./LazyComponent.testStub.svelte'))
    await settle()
    expect(target.querySelector('[data-testid="lazy-component-loaded"]')).not.toBeNull()
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
