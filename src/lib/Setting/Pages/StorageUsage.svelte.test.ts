import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorageUsageResponse } from '@risuai/protocol/storage-usage'
vi.mock('src/ts/storage/fastifyStorage', () => ({ getNodeServerProxyAuth: async () => 'storage-auth' }))
import { language } from 'src/lang'
import StorageUsage from './StorageUsage.svelte'

let target: HTMLElement
let component: ReturnType<typeof mount> | undefined
let fetchMock: ReturnType<typeof vi.fn>
const report: StorageUsageResponse = {
  measuredAt: 1_780_000_000_000,
  totalBytes: 4096,
  categories: { database: 1024, journal: 0, assets: 2048, backups: 1024, legacy: 0, logs: 0, other: 0 },
  disk: { totalBytes: 1024 ** 3, availableBytes: 1024 ** 2 },
  partial: false,
}
const response = (value: unknown = report) => new Response(JSON.stringify(value))
function button(): HTMLButtonElement {
  return target.querySelector('button')!
}

beforeEach(() => {
  fetchMock = vi.fn(async () => response())
  vi.stubGlobal('fetch', fetchMock)
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (component) await unmount(component)
  component = undefined
  target.remove()
  vi.unstubAllGlobals()
})

describe('server storage card', () => {
  it('loads authenticated totals, accessible category explanations and disk capacity', async () => {
    component = mount(StorageUsage, { target })
    await vi.waitFor(() => expect(target.textContent).toContain('4 KiB'))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/storage-usage',
      expect.objectContaining({
        cache: 'no-store',
        headers: { 'risu-auth': 'storage-auth' },
        signal: expect.any(AbortSignal),
      }),
    )
    expect(target.querySelectorAll('summary')).toHaveLength(7)
    expect(target.textContent).toContain(language.storageUsage.diskAvailable('1 MiB', '1 GiB'))
    expect(target.textContent).toContain(language.storageUsage.descriptions.assets)
    expect(button().disabled).toBe(false)
  })

  it('shows loading, preserves the last measurement on refresh failure and supports retry', async () => {
    let finish!: (value: Response) => void
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    component = mount(StorageUsage, { target })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(button().disabled).toBe(true)
    expect(target.textContent).toContain(language.storageUsage.loading)
    finish(response())
    await vi.waitFor(() => expect(button().disabled).toBe(false))
    fetchMock.mockRejectedValueOnce(new Error('private server details'))
    button().click()
    await vi.waitFor(() => expect(target.textContent).toContain(language.storageUsage.refreshFailed))
    expect(target.textContent).toContain('4 KiB')
    expect(target.textContent).not.toContain('private server details')
    expect(button().textContent).toContain(language.storageUsage.retry)
    button().click()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).toBeNull())
  })

  it.each([
    {},
    { ...report, totalBytes: -1 },
    { ...report, totalBytes: 1 },
    { ...report, disk: { totalBytes: 1, availableBytes: 2 } },
  ])('rejects malformed or inconsistent results', async (invalid) => {
    fetchMock.mockResolvedValueOnce(response(invalid))
    component = mount(StorageUsage, { target })
    await vi.waitFor(() => expect(target.textContent).toContain(language.storageUsage.failed))
    expect(target.textContent).not.toContain(language.storageUsage.total)
    expect(button().disabled).toBe(false)
  })

  it('handles empty totals, incomplete measurements, and unavailable disk capacity', async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        ...report,
        totalBytes: 0,
        categories: { database: 0, journal: 0, assets: 0, backups: 0, legacy: 0, logs: 0, other: 0 },
        partial: true,
        disk: null,
      }),
    )
    component = mount(StorageUsage, { target })
    await vi.waitFor(() => expect(target.textContent).toContain(language.storageUsage.partial))
    expect(target.textContent).toContain('0 B')
    expect(target.textContent).toContain(language.storageUsage.diskUnavailable)
    expect(target.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('aborts the request when leaving settings', async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )
    component = mount(StorageUsage, { target })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    await unmount(component)
    component = undefined
    await tick()
    expect(signal.aborted).toBe(true)
  })
})
