import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import { testDatabaseState } from './__tests__/resourceDatabaseState'
import { selectFileByDom } from './util'

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
})
