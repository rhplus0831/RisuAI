import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import { testDatabaseState } from './__tests__/resourceDatabaseState'
import { selectFileByDom } from './filePicker'
import { settingsResourceState } from './server/resourceState.svelte'

beforeEach(() => {
  testDatabaseState.db = { allowAllExtentionFiles: false } as never
})

afterEach(() => {
  document.querySelectorAll('input[type="file"]').forEach((input) => input.remove())
  testDatabaseState.db = {}
})

describe('selectFileByDom', () => {
  it('settles and removes its hidden input when the native picker is cancelled', async () => {
    const selection = selectFileByDom(['png'])
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).toBeTruthy()

    input!.dispatchEvent(new Event('cancel'))

    await expect(selection).resolves.toEqual([])
    expect(input!.isConnected).toBe(false)
  })

  it('also removes its hidden input when change reports no files', async () => {
    const selection = selectFileByDom(['png'])
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).toBeTruthy()

    input!.dispatchEvent(new Event('change'))

    await expect(selection).resolves.toEqual([])
    expect(input!.isConnected).toBe(false)
  })

  it('accepts every extension only from a ready advanced-settings owner', async () => {
    testDatabaseState.db = { allowAllExtentionFiles: true } as never

    const selection = selectFileByDom(['png'])
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input?.accept).toBe('*')
    input!.dispatchEvent(new Event('cancel'))
    await expect(selection).resolves.toEqual([])
  })

  it.each(['loading', 'error'] as const)('restricts extensions when the advanced owner is %s', async (status) => {
    testDatabaseState.db = { allowAllExtentionFiles: true } as never
    settingsResourceState.groupStatuses.advanced = status

    const selection = selectFileByDom(['png'])
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input?.accept).toBe('.png')
    input!.dispatchEvent(new Event('cancel'))
    await expect(selection).resolves.toEqual([])
  })

  it('restricts extensions when the settings owner is in error', async () => {
    testDatabaseState.db = { allowAllExtentionFiles: true } as never
    settingsResourceState.status = 'error'

    const selection = selectFileByDom(['png'])
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input?.accept).toBe('.png')
    input!.dispatchEvent(new Event('cancel'))
    await expect(selection).resolves.toEqual([])
  })
})
