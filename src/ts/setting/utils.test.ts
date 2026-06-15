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

import { clearCachedServerCommandRevision, settingsGroupForKey } from '../server/commands'
import { setServerProjectionWriteGuardEnabled } from '../server/projectionWriteGuard.svelte'
import { DBState } from '../stores.svelte'
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
import { displayOtherSettingsItems, displaySettingsItems } from './displaySettingsData.svelte'
import { languageSettingsItems } from './languageSettingsData.svelte'
import type { SettingContext, SettingItem } from './types'
import { setSettingValue } from './utils'

interface CapturedFetch {
  url: string
  method: string
  body: unknown
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
      calls.push({ url, method: init.method ?? 'GET', body })
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 4 })
      if (url === '/api/v1/commands/settings/display') {
        return jsonResponse({ error: 'revision_conflict', currentRevision: 8 }, 409)
      }
      return jsonResponse({ revision: 9, event: { type: 'settings.updated' } })
    }) as unknown as typeof fetch,
  )
  return calls
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
  setServerProjectionWriteGuardEnabled(false)
  DBState.db = { notification: false } as any
})

afterEach(() => {
  vi.unstubAllGlobals()
  setServerProjectionWriteGuardEnabled(false)
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
      bindKey: 'notification' as keyof typeof DBState.db,
    }
    const ctx = { db: DBState.db, modelInfo: {}, subModelInfo: {} } as SettingContext

    setSettingValue(item, true, ctx)

    await vi.waitFor(() => {
      expect(DBState.db.notification).toBe(false)
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
})
