import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const developModeMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  importPlugin: vi.fn(async () => true),
}))

vi.mock('src/ts/alert', () => ({
  alertError: developModeMocks.alertError,
}))

vi.mock('src/ts/plugins/plugins.svelte', () => ({
  importPlugin: developModeMocks.importPlugin,
}))

import { hotReloadPluginFiles, type PluginHotReloadSession } from './developMode'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function pluginFile(name: string, content: string, lastModified: number) {
  return {
    name,
    lastModified,
    text: vi.fn(async () => content),
  } as unknown as File
}

function fileHandle(getFile: () => File | Promise<File>) {
  return {
    getFile: vi.fn(getFile),
  } as unknown as FileSystemFileHandle
}

async function flushAsyncWork(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve()
}

describe('plugin development hot reload', () => {
  const sessions: PluginHotReloadSession[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    developModeMocks.alertError.mockReset()
    developModeMocks.importPlugin.mockReset()
    developModeMocks.importPlugin.mockResolvedValue(true)
  })

  afterEach(async () => {
    for (const session of sessions.splice(0)) session.stop()
    await flushAsyncWork()
    vi.clearAllTimers()
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'showOpenFilePicker')
  })

  it('replaces the active poller without letting its stale stop handle stop the successor', async () => {
    let firstFile = pluginFile('first.ts', 'first-1', 1)
    let secondFile = pluginFile('second.js', 'second-1', 1)
    const firstHandle = fileHandle(() => firstFile)
    const secondHandle = fileHandle(() => secondFile)
    const picker = vi.fn().mockResolvedValueOnce([firstHandle]).mockResolvedValueOnce([secondHandle])
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: picker })

    const firstSession = hotReloadPluginFiles()
    sessions.push(firstSession)
    await flushAsyncWork()
    expect(developModeMocks.importPlugin).toHaveBeenNthCalledWith(1, 'first-1', {
      isHotReload: true,
      isUpdate: true,
      isTypescript: true,
    })

    const secondSession = hotReloadPluginFiles()
    sessions.push(secondSession)
    await flushAsyncWork()
    expect(developModeMocks.importPlugin).toHaveBeenNthCalledWith(2, 'second-1', {
      isHotReload: true,
      isUpdate: true,
      isTypescript: false,
    })

    firstSession.stop()
    firstFile = pluginFile('first.ts', 'first-2', 2)
    secondFile = pluginFile('second.js', 'second-2', 2)
    await vi.advanceTimersByTimeAsync(500)
    await flushAsyncWork()

    expect(firstHandle.getFile).toHaveBeenCalledOnce()
    expect(secondHandle.getFile).toHaveBeenCalledTimes(2)
    expect(developModeMocks.importPlugin).toHaveBeenCalledTimes(3)
    expect(developModeMocks.importPlugin).toHaveBeenLastCalledWith('second-2', {
      isHotReload: true,
      isUpdate: true,
      isTypescript: false,
    })

    secondSession.stop()
    await expect(secondSession.done).resolves.toBeUndefined()
  })

  it('ignores a file-picker result that arrives after the session is stopped', async () => {
    const picked = deferred<FileSystemFileHandle[]>()
    const handle = fileHandle(() => pluginFile('late.ts', 'late', 1))
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: vi.fn(() => picked.promise),
    })

    const session = hotReloadPluginFiles()
    sessions.push(session)
    await Promise.resolve()
    expect(window.showOpenFilePicker).toHaveBeenCalledOnce()
    session.stop()
    picked.resolve([handle])
    await expect(session.done).resolves.toBeUndefined()

    expect(handle.getFile).not.toHaveBeenCalled()
    expect(developModeMocks.importPlugin).not.toHaveBeenCalled()
  })

  it('does not import file text that finishes after the session is stopped', async () => {
    const content = deferred<string>()
    const file = {
      name: 'pending.ts',
      lastModified: 1,
      text: vi.fn(() => content.promise),
    } as unknown as File
    const handle = fileHandle(() => file)
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: vi.fn(async () => [handle]),
    })

    const session = hotReloadPluginFiles()
    sessions.push(session)
    await flushAsyncWork()
    expect(file.text).toHaveBeenCalledOnce()

    session.stop()
    content.resolve('too late')
    await expect(session.done).resolves.toBeUndefined()
    expect(developModeMocks.importPlugin).not.toHaveBeenCalled()
  })
})
