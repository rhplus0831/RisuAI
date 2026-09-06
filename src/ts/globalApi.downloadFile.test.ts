import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const streamSaverState = vi.hoisted(() => ({
  moduleLoads: 0,
  writer: {
    write: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  },
  getWriter: vi.fn(),
  createWriteStream: vi.fn(),
}))

vi.mock('streamsaver', () => {
  streamSaverState.moduleLoads += 1
  return {
    default: {
      createWriteStream: streamSaverState.createWriteStream,
    },
  }
})

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
import { downloadFile, LocalWriter } from './globalApi.svelte'

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
  streamSaverState.writer.write.mockClear()
  streamSaverState.writer.close.mockClear()
  streamSaverState.getWriter.mockClear()
  streamSaverState.createWriteStream.mockClear()
  streamSaverState.getWriter.mockReturnValue(streamSaverState.writer)
  streamSaverState.createWriteStream.mockReturnValue({ getWriter: streamSaverState.getWriter })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('downloadFile object URL lifetime', () => {
  it('keeps the default 10-second revocation for ordinary downloads', async () => {
    await downloadFile('ordinary.json', '{}')

    expect(streamSaverState.moduleLoads).toBe(0)
    expect(streamSaverState.createWriteStream).not.toHaveBeenCalled()
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

describe('LocalWriter streamed download loading', () => {
  it('loads streamsaver only when a stream is initialized', async () => {
    const writer = new LocalWriter()

    expect(streamSaverState.moduleLoads).toBe(0)
    await expect(writer.init('Image File', ['png'])).resolves.toBe(true)

    expect(streamSaverState.moduleLoads).toBe(1)
    expect(streamSaverState.createWriteStream).toHaveBeenCalledWith('Image File.png')
    expect(streamSaverState.getWriter).toHaveBeenCalledOnce()
    expect(writer.writer).toBe(streamSaverState.writer)
  })

  it('reuses the loaded module while creating a stream for each initialization', async () => {
    const writer = new LocalWriter()

    await writer.init('First', ['bin'])
    await writer.init('Second', ['risu'])

    expect(streamSaverState.moduleLoads).toBe(1)
    expect(streamSaverState.createWriteStream).toHaveBeenNthCalledWith(1, 'First.bin')
    expect(streamSaverState.createWriteStream).toHaveBeenNthCalledWith(2, 'Second.risu')
  })
})
