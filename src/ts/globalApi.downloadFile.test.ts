import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return { ...actual, isFastifyServer: true }
})

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'proxy-auth-token',
}))

vi.mock('./process/modules', async (importActual) => {
  const actual = await importActual<typeof import('./process/modules')>()
  return { ...actual, moduleUpdate: vi.fn() }
})

import { testDatabaseState } from './__tests__/resourceDatabaseState'
import { downloadFile } from './globalApi.svelte'

let createObjectURL: ReturnType<typeof vi.spyOn>
let revokeObjectURL: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  testDatabaseState.db = {
    usePlainFetch: false,
    requestLocation: '',
    modules: [],
    enabledModules: [],
    characters: [],
  }
  vi.useFakeTimers()
  createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download')
  revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('downloadFile object URL lifetime', () => {
  it('keeps the default 10-second revocation for ordinary downloads', async () => {
    await downloadFile('ordinary.json', '{}')

    expect(revokeObjectURL).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(9_999)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download')
  })

  it('can keep a destructive-reset-gating download URL alive', async () => {
    await downloadFile('all-chats.json', '{}', { revokeObjectUrlAfterMs: null })

    await vi.runAllTimersAsync()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })
})
