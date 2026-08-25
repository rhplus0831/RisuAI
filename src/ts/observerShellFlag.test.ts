import { afterEach, describe, expect, it, vi } from 'vitest'
import { __observerShellFlagTestHooks, isPreWriterObserverShellEnabled } from './observerShellFlag'

afterEach(() => {
  __observerShellFlagTestHooks.setOverride(null)
  sessionStorage.clear()
  vi.unstubAllEnvs()
})

describe('pre-writer observer shell rollout flag', () => {
  it('defaults off and accepts an explicit build-time enablement', () => {
    vi.stubEnv('VITE_FAST_BOOTSTRAP_OBSERVER', '')
    expect(isPreWriterObserverShellEnabled()).toBe(false)

    vi.stubEnv('VITE_FAST_BOOTSTRAP_OBSERVER', 'TRUE')
    expect(isPreWriterObserverShellEnabled()).toBe(true)
  })

  it('supports a deterministic test override', () => {
    vi.stubEnv('VITE_FAST_BOOTSTRAP_OBSERVER', '')

    __observerShellFlagTestHooks.setOverride(true)
    expect(isPreWriterObserverShellEnabled()).toBe(true)

    __observerShellFlagTestHooks.setOverride(false)
    expect(isPreWriterObserverShellEnabled()).toBe(false)
  })

  it('allows browser smoke to select either journey without changing production storage behavior', () => {
    vi.stubEnv('VITE_FASTIFY_BROWSER_SMOKE', 'TRUE')
    sessionStorage.setItem(__observerShellFlagTestHooks.smokeOverrideStorageKey, 'enabled')
    expect(isPreWriterObserverShellEnabled()).toBe(true)

    sessionStorage.setItem(__observerShellFlagTestHooks.smokeOverrideStorageKey, 'disabled')
    expect(isPreWriterObserverShellEnabled()).toBe(false)

    vi.stubEnv('VITE_FASTIFY_BROWSER_SMOKE', '')
    sessionStorage.setItem(__observerShellFlagTestHooks.smokeOverrideStorageKey, 'enabled')
    expect(isPreWriterObserverShellEnabled()).toBe(false)
  })
})
