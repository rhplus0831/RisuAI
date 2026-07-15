import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../platform', async (importActual) => {
  const actual = await importActual<typeof import('../platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'setting-auth-token',
}))

vi.mock('../process/modules', async (importActual) => {
  const actual = await importActual<typeof import('../process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import {
  clearCachedServerCommandRevision,
  setServerCommandSuccessReconciler,
  settingsGroupForKey,
  type ServerCommandLocalEffect,
} from '../server/commands'
import {
  applySettingsGroupResource,
  captureSettingsGroupProjectionEpoch,
  getResourceDatabase,
  hasSettingsGroupProjectionEpochChanged,
  replaceResourceDatabase,
} from '../server/resourceState.svelte'
import { setResourceWriteGuardEnabled, withServerResourceApply } from '../server/resourceWriteGuard.svelte'
import { notifyServerCommandLocalEffectApplied } from '../server/commandLocalEffectEvents'
import { createDestructiveRefreshToken } from '../server/staleStateGuards'
import { accessibilitySettingsItems } from './accessibilitySettingsData'
import { advancedSettingsItems } from './advancedSettingsData'
import {
  basicParameterItems,
  modelSpecificParameterItems,
  penaltyParameterItems,
  samplingParameterItems,
  seedSetting,
} from './botSettingsParamsData'
import { chatFormatSettingsItems } from './chatFormatSettingsData'
import {
  displayNonRendererServerSettingKeys,
  displayOtherSettingsItems,
  displaySettingsItems,
} from './displaySettingsData.svelte'
import { languageSettingsItems } from './languageSettingsData.svelte'
import type { SettingContext, SettingItem } from './types'
import {
  clearDeferredSettingWrites,
  DEFERRED_SETTING_INPUT_DELAY_MS,
  flushDeferredSettingWrites,
  setDeferredSettingValue,
  setSettingValue,
} from './utils'
import SettingInputDraftHarness from 'src/lib/Setting/testHarness/SettingInputDraftHarness.svelte'

interface CapturedFetch {
  url: string
  method: string
  body: unknown
  keepalive?: boolean
}

const settingRendererItemSets: SettingItem[][] = [
  accessibilitySettingsItems,
  advancedSettingsItems,
  basicParameterItems,
  [seedSetting],
  samplingParameterItems,
  penaltyParameterItems,
  modelSpecificParameterItems,
  chatFormatSettingsItems,
  displaySettingsItems,
  languageSettingsItems,
]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubSettingsFetch(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      calls.push({
        url,
        method: init.method ?? 'GET',
        body,
        ...(init.keepalive ? { keepalive: true } : {}),
      })
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 4 })
      if (url === '/api/v1/commands/settings/display') {
        return jsonResponse({ error: 'revision_conflict', currentRevision: 8 }, 409)
      }
      return jsonResponse({ revision: 9, event: { type: 'settings.updated' } })
    }) as unknown as typeof fetch,
  )
  return calls
}

function stubSuccessfulSettingsFetch(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      calls.push({
        url,
        method: init.method ?? 'GET',
        body,
        ...(init.keepalive ? { keepalive: true } : {}),
      })
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 4 })
      return jsonResponse({ revision: 5, event: { type: 'settings.updated' } })
    }) as unknown as typeof fetch,
  )
  return calls
}

function deferredResponse(): {
  promise: Promise<Response>
  resolve: (response: Response) => void
} {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

function collectSettingItems(items: SettingItem[]): SettingItem[] {
  const collected: SettingItem[] = []

  for (const item of items) {
    collected.push(item)
    if (item.options?.children) {
      collected.push(...collectSettingItems(item.options.children))
    }
  }

  return collected
}

function serverCommandKeyForSetting(item: SettingItem): string | null {
  if (item.bindPath) return item.bindPath.split('.')[0] ?? null
  return item.bindKey ? String(item.bindKey) : null
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setServerCommandSuccessReconciler(null)
  setResourceWriteGuardEnabled(false)
  replaceResourceDatabase({ notification: false } as any)
})

afterEach(() => {
  clearDeferredSettingWrites()
  setServerCommandSuccessReconciler(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
  setResourceWriteGuardEnabled(false)
})

describe('server-backed data-driven settings', () => {
  it('maps every data-driven SettingRenderer binding to a server command group', () => {
    const missing = settingRendererItemSets.flatMap(collectSettingItems).flatMap((item) => {
      const key = serverCommandKeyForSetting(item)
      if (!key || settingsGroupForKey(key)) return []
      return [`${item.id} -> ${key}`]
    })

    expect(missing).toEqual([])
  })

  it('does not expose the legacy API-key visibility toggle', () => {
    const displayItems = collectSettingItems(displayOtherSettingsItems)

    expect(displayItems.some((item) => item.id === 'display.hideApiKey')).toBe(false)
    expect(displayItems.some((item) => item.bindKey === 'hideApiKey')).toBe(false)
  })

  it('keeps Display custom-control watchers disjoint from renderer-owned bindings', () => {
    const rendererKeys = new Set(
      collectSettingItems(displaySettingsItems).flatMap((item) =>
        item.bindPath ? [item.bindPath.split('.')[0]] : item.bindKey ? [String(item.bindKey)] : [],
      ),
    )

    expect(displayNonRendererServerSettingKeys.filter((key) => rendererKeys.has(key))).toEqual([])
  })

  it('renders data-driven translator secrets as hidden text fields', () => {
    const languageItems = collectSettingItems(languageSettingsItems)

    expect(languageItems.find((item) => item.bindPath === 'deeplOptions.key')?.options?.hideText).toBe(true)
    expect(languageItems.find((item) => item.bindPath === 'deeplXOptions.token')?.options?.hideText).toBe(true)
  })

  it('surfaces conflicts without replaying the same setting patch', async () => {
    const calls = stubSettingsFetch()
    const item: SettingItem = {
      id: 'notification',
      type: 'check',
      bindKey: 'notification' as keyof ReturnType<typeof getResourceDatabase>,
    }
    const ctx = { db: getResourceDatabase(), modelInfo: {}, subModelInfo: {} } as SettingContext

    setSettingValue(item, true, ctx)

    await vi.waitFor(() => {
      expect(getResourceDatabase().notification).toBe(false)
    })

    expect(calls).toEqual([
      { url: '/api/v1/bootstrap', method: 'GET', body: null },
      {
        url: '/api/v1/commands/settings/display',
        method: 'PATCH',
        body: { baseRevision: 4, patch: { notification: true } },
      },
    ])
  })

  it('reapplies runtime side effects when an immediate setting patch rolls back', async () => {
    const calls = stubSettingsFetch()
    replaceResourceDatabase({ animationSpeed: 1 } as any)
    const appliedRuntimeValues: Array<{ stored: unknown; value: unknown }> = []
    const item: SettingItem = {
      id: 'display.animationSpeed',
      type: 'slider',
      bindKey: 'animationSpeed' as keyof ReturnType<typeof getResourceDatabase>,
      onChange: (value) => {
        appliedRuntimeValues.push({ stored: getResourceDatabase().animationSpeed, value })
      },
    }
    const ctx = { db: getResourceDatabase(), modelInfo: {}, subModelInfo: {} } as SettingContext

    setSettingValue(item, 0.25, ctx)

    await vi.waitFor(() => {
      expect(getResourceDatabase().animationSpeed).toBe(1)
    })

    expect(appliedRuntimeValues).toEqual([
      { stored: 0.25, value: 0.25 },
      { stored: 1, value: 1 },
    ])
    expect(calls).toEqual([
      { url: '/api/v1/bootstrap', method: 'GET', body: null },
      {
        url: '/api/v1/commands/settings/display',
        method: 'PATCH',
        body: { baseRevision: 4, patch: { animationSpeed: 0.25 } },
      },
    ])
  })

  it('reapplies runtime side effects when a deferred setting patch rolls back', async () => {
    vi.useFakeTimers()
    const calls = stubSettingsFetch()
    replaceResourceDatabase({ animationSpeed: 1 } as any)
    const appliedRuntimeValues: Array<{ stored: unknown; value: unknown }> = []
    const item: SettingItem = {
      id: 'display.animationSpeed',
      type: 'slider',
      bindKey: 'animationSpeed' as keyof ReturnType<typeof getResourceDatabase>,
      onChange: (value) => {
        appliedRuntimeValues.push({ stored: getResourceDatabase().animationSpeed, value })
      },
    }
    const ctx = { db: getResourceDatabase(), modelInfo: {}, subModelInfo: {} } as SettingContext

    setDeferredSettingValue(item, 0.25, ctx)

    await vi.advanceTimersByTimeAsync(DEFERRED_SETTING_INPUT_DELAY_MS)
    await vi.waitFor(() => {
      expect(getResourceDatabase().animationSpeed).toBe(1)
    })

    expect(appliedRuntimeValues).toEqual([
      { stored: 0.25, value: 0.25 },
      { stored: 1, value: 1 },
    ])
    expect(calls).toEqual([
      { url: '/api/v1/bootstrap', method: 'GET', body: null },
      {
        url: '/api/v1/commands/settings/display',
        method: 'PATCH',
        body: { baseRevision: 4, patch: { animationSpeed: 0.25 } },
      },
    ])
  })

  it('patches one custom quote as an array field and restores it when persistence fails', async () => {
    vi.useFakeTimers()
    const calls = stubSettingsFetch()
    replaceResourceDatabase({
      customQuotes: true,
      customQuotesData: ['"', '"', "'", "'"],
      modelPresets: [],
      modelPresetsId: -1,
      promptPresets: [],
      promptPresetsId: -1,
    } as any)
    const item = displaySettingsItems.find((candidate) => candidate.id === 'display.leadingDoubleQuote')!
    const ctx = { db: getResourceDatabase(), modelInfo: {}, subModelInfo: {} } as SettingContext

    setDeferredSettingValue(item, '«', ctx)
    expect(getResourceDatabase().customQuotesData).toEqual(['«', '"', "'", "'"])

    await vi.advanceTimersByTimeAsync(DEFERRED_SETTING_INPUT_DELAY_MS)
    await vi.waitFor(() => {
      expect(getResourceDatabase().customQuotesData).toEqual(['"', '"', "'", "'"])
    })

    expect(calls).toEqual([
      { url: '/api/v1/bootstrap', method: 'GET', body: null },
      {
        url: '/api/v1/commands/settings/display',
        method: 'PATCH',
        body: {
          baseRevision: 4,
          patch: { customQuotesData: ['«', '"', "'", "'"] },
        },
      },
    ])
  })

  it('restores local state when a number clear would produce an undefined server patch', async () => {
    const calls = stubSettingsFetch()
    replaceResourceDatabase({ maxResponse: 100 } as any)
    const item: SettingItem = {
      id: 'maxResponse',
      type: 'number',
      bindKey: 'maxResponse' as keyof ReturnType<typeof getResourceDatabase>,
    }
    const ctx = { db: getResourceDatabase(), modelInfo: {}, subModelInfo: {} } as SettingContext

    setSettingValue(item, undefined, ctx)

    await vi.waitFor(() => {
      expect(getResourceDatabase().maxResponse).toBe(100)
    })

    expect(calls).toEqual([])
  })

  it('skips rollback when a destructive refresh lands before a setting patch failure', async () => {
    const patchResponse = deferredResponse()
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        calls.push({ url, method: init.method ?? 'GET', body })
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 4 })
        if (url === '/api/v1/commands/settings/display') return patchResponse.promise
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    const item: SettingItem = {
      id: 'notification',
      type: 'check',
      bindKey: 'notification' as keyof ReturnType<typeof getResourceDatabase>,
    }
    const ctx = { db: getResourceDatabase(), modelInfo: {}, subModelInfo: {} } as SettingContext

    setSettingValue(item, true, ctx)
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/settings/display')).toBe(true)
    })
    expect(getResourceDatabase().notification).toBe(true)

    createDestructiveRefreshToken('setting-renderer-test-refresh')
    patchResponse.resolve(jsonResponse({ error: 'nope' }, 500))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getResourceDatabase().notification).toBe(true)
  })

  it('keeps the latest rapid text draft through an intermediate projection and sends only the final value', async () => {
    vi.useFakeTimers()
    const calls = stubSuccessfulSettingsFetch()
    replaceResourceDatabase({
      guiHTML: 'server initial',
      modelPresets: [],
      modelPresetsId: -1,
      promptPresets: [],
      promptPresetsId: -1,
    } as any)
    const item: SettingItem = {
      id: 'display.guiHTML',
      type: 'textarea',
      bindKey: 'guiHTML' as keyof ReturnType<typeof getResourceDatabase>,
    }
    const ctx = { db: getResourceDatabase(), modelInfo: {}, subModelInfo: {} } as SettingContext
    const target = document.createElement('div')
    const component = mount(SettingInputDraftHarness, { target, props: { ctx, item, kind: 'text' } })
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-setting-input-draft]')!

    for (const value of ['l', 'lo', 'local final']) {
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      flushSync()
    }

    expect(getResourceDatabase().guiHTML).toBe('local final')
    expect(calls).toEqual([])

    withServerResourceApply(() => {
      getResourceDatabase().guiHTML = 'server intermediate'
    })
    flushSync()

    expect(input.value).toBe('local final')
    expect(getResourceDatabase().guiHTML).toBe('local final')

    await vi.advanceTimersByTimeAsync(DEFERRED_SETTING_INPUT_DELAY_MS)
    await Promise.resolve()

    const patches = calls.filter((call) => call.url === '/api/v1/commands/settings/display')
    expect(patches).toHaveLength(1)
    expect(patches[0].body).toMatchObject({ patch: { guiHTML: 'local final' } })
    unmount(component)
  })

  it('shows a canonical settings receipt in the input that produced the accepted attempt', () => {
    replaceResourceDatabase({
      deeplOptions: { key: 'server initial', freeApi: false },
      modelPresets: [],
      modelPresetsId: -1,
      promptPresets: [],
      promptPresetsId: -1,
    } as any)
    const item: SettingItem = {
      id: 'language.deepl.key',
      type: 'text',
      bindPath: 'deeplOptions.key',
    }
    const ctx = { db: getResourceDatabase(), modelInfo: {}, subModelInfo: {} } as SettingContext
    const target = document.createElement('div')
    const component = mount(SettingInputDraftHarness, { target, props: { ctx, item, kind: 'text' } })
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-setting-input-draft]')!

    input.value = 'attempted key'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    withServerResourceApply(() => {
      getResourceDatabase().deeplOptions = { key: 'canonical key', freeApi: false }
    })
    notifyServerCommandLocalEffectApplied(
      {
        type: 'settings.updated',
        revision: 5,
        resource: 'settings',
        id: 'language',
      },
      {
        kind: 'settingsPatch',
        group: 'language',
        attemptedPatch: { deeplOptions: { key: 'attempted key', freeApi: false } },
        settings: { deeplOptions: { key: 'canonical key', freeApi: false } },
        settingsProjectionEpoch: 0,
      },
    )
    flushSync()

    expect(input.value).toBe('canonical key')
    expect(getResourceDatabase().deeplOptions).toEqual({ key: 'canonical key', freeApi: false })
    unmount(component)
  })

  it('keeps a destroyed input intent fenced to its pre-projection group epoch', async () => {
    vi.useFakeTimers()
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        calls.push({ url, method: init.method ?? 'GET', body })
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 4 })
        if (url === '/api/v1/commands/settings/display') {
          return jsonResponse({
            revision: 5,
            event: {
              type: 'settings.updated',
              revision: 5,
              resource: 'settings',
              id: 'display',
            },
            acknowledgedKeys: ['guiHTML'],
            settings: {},
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    replaceResourceDatabase({
      guiHTML: 'server initial',
      modelPresets: [],
      modelPresetsId: -1,
      promptPresets: [],
      promptPresetsId: -1,
    } as any)
    const item: SettingItem = {
      id: 'display.guiHTML',
      type: 'textarea',
      bindKey: 'guiHTML' as keyof ReturnType<typeof getResourceDatabase>,
    }
    const ctx = { db: getResourceDatabase(), modelInfo: {}, subModelInfo: {} } as SettingContext
    const observedEffects: ServerCommandLocalEffect[] = []
    let finishReconciliation!: () => void
    const reconciliationFinished = new Promise<void>((resolve) => {
      finishReconciliation = resolve
    })
    setServerCommandSuccessReconciler((_event, _events, localEffects) => {
      observedEffects.push(...localEffects.values())
      finishReconciliation()
    })
    const intentEpoch = captureSettingsGroupProjectionEpoch('display')
    const target = document.createElement('div')
    const component = mount(SettingInputDraftHarness, { target, props: { ctx, item, kind: 'text' } })
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-setting-input-draft]')!

    input.value = 'local final'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    unmount(component)
    withServerResourceApply(() =>
      applySettingsGroupResource(
        {
          revision: 4,
          group: 'display',
          settings: { guiHTML: 'server intermediate' },
        },
        ['guiHTML'],
      ),
    )
    expect(hasSettingsGroupProjectionEpochChanged('display', intentEpoch)).toBe(true)
    expect(getResourceDatabase().guiHTML).toBe('server intermediate')

    await vi.advanceTimersByTimeAsync(DEFERRED_SETTING_INPUT_DELAY_MS)
    await reconciliationFinished

    expect(calls.filter((call) => call.url === '/api/v1/commands/settings/display')).toHaveLength(1)
    expect(observedEffects).toEqual([
      {
        kind: 'settingsPatch',
        group: 'display',
        attemptedPatch: { guiHTML: 'local final' },
        settings: { guiHTML: 'local final' },
        settingsProjectionEpoch: intentEpoch,
      },
    ])
    expect(getResourceDatabase().guiHTML).toBe('server intermediate')
  })

  it('bounds rapid slider persistence to one dispatch with the final value', async () => {
    vi.useFakeTimers()
    const calls = stubSuccessfulSettingsFetch()
    replaceResourceDatabase({
      modelPresets: [],
      modelPresetsId: -1,
      promptPresets: [],
      promptPresetsId: -1,
      zoomsize: 50,
    } as any)
    const item: SettingItem = {
      id: 'display.zoomsize',
      type: 'slider',
      bindKey: 'zoomsize' as keyof ReturnType<typeof getResourceDatabase>,
    }
    const ctx = { db: getResourceDatabase(), modelInfo: {}, subModelInfo: {} } as SettingContext
    const target = document.createElement('div')
    const component = mount(SettingInputDraftHarness, { target, props: { ctx, item, kind: 'slider' } })
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-setting-input-draft]')!

    for (let value = 51; value <= 150; value += 1) {
      input.value = String(value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      flushSync()
    }

    expect(getResourceDatabase().zoomsize).toBe(150)
    expect(calls).toEqual([])

    await vi.advanceTimersByTimeAsync(DEFERRED_SETTING_INPUT_DELAY_MS)
    await Promise.resolve()

    const patches = calls.filter((call) => call.url === '/api/v1/commands/settings/display')
    expect(patches).toHaveLength(1)
    expect(patches[0].body).toMatchObject({ patch: { zoomsize: 150 } })
    unmount(component)
  })

  it('coalesces sibling bind paths into one effective-root patch', async () => {
    vi.useFakeTimers()
    const calls = stubSuccessfulSettingsFetch()
    replaceResourceDatabase({
      deeplOptions: { key: 'old key', proxy: 'old proxy' },
      modelPresets: [],
      modelPresetsId: -1,
      promptPresets: [],
      promptPresetsId: -1,
    } as any)
    const keyItem: SettingItem = {
      id: 'language.deepl.key',
      type: 'text',
      bindPath: 'deeplOptions.key',
    }
    const proxyItem: SettingItem = {
      id: 'language.deepl.proxy',
      type: 'text',
      bindPath: 'deeplOptions.proxy',
    }
    const ctx = { db: getResourceDatabase(), modelInfo: {}, subModelInfo: {} } as SettingContext

    setDeferredSettingValue(keyItem, 'final key', ctx)
    setDeferredSettingValue(proxyItem, 'final proxy', ctx)

    await vi.advanceTimersByTimeAsync(DEFERRED_SETTING_INPUT_DELAY_MS)
    await Promise.resolve()

    const patches = calls.filter((call) => call.url.startsWith('/api/v1/commands/settings/'))
    expect(patches).toHaveLength(1)
    expect(patches[0].body).toMatchObject({
      patch: { deeplOptions: { key: 'final key', proxy: 'final proxy' } },
    })
  })

  it('flushes the final deferred input with keepalive before its timer fires', async () => {
    vi.useFakeTimers()
    const calls = stubSuccessfulSettingsFetch()
    replaceResourceDatabase({
      guiHTML: 'before',
      modelPresets: [],
      modelPresetsId: -1,
      promptPresets: [],
      promptPresetsId: -1,
    } as any)
    const item: SettingItem = {
      id: 'display.guiHTML',
      type: 'textarea',
      bindKey: 'guiHTML' as keyof ReturnType<typeof getResourceDatabase>,
    }
    const ctx = { db: getResourceDatabase(), modelInfo: {}, subModelInfo: {} } as SettingContext

    setDeferredSettingValue(item, 'last keystroke', ctx)
    flushDeferredSettingWrites({ keepalive: true })
    await vi.advanceTimersByTimeAsync(0)

    const patches = calls.filter((call) => call.url === '/api/v1/commands/settings/display')
    expect(patches).toHaveLength(1)
    expect(patches[0]).toMatchObject({
      body: { patch: { guiHTML: 'last keystroke' } },
      keepalive: true,
    })

    await vi.advanceTimersByTimeAsync(DEFERRED_SETTING_INPUT_DELAY_MS)
    expect(calls.filter((call) => call.url === '/api/v1/commands/settings/display')).toHaveLength(1)
  })
})
