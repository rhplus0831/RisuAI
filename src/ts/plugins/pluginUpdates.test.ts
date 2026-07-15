import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateMocks = vi.hoisted(() => ({
  getPluginPermission: vi.fn(async () => true),
  hasher: vi.fn(async (value: Uint8Array) => new TextDecoder().decode(value)),
  pluginFetchNative: vi.fn(),
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  pluginFetchNative: updateMocks.pluginFetchNative,
}))

vi.mock('src/ts/parser/parser.svelte', () => ({
  hasher: updateMocks.hasher,
}))

vi.mock('./pluginPermissions', () => ({
  getPluginPermission: updateMocks.getPluginPermission,
}))

import {
  PLUGIN_UPDATE_SCRIPT_MAX_BYTES,
  checkPluginUpdate,
  downloadPluginUpdate,
  readPluginUpdateText,
} from './pluginUpdates'

function plugin(patch: Partial<{ name: string; script: string; updateURL: string; versionOfPlugin: string }> = {}) {
  return {
    name: 'example-plugin',
    script: 'Risuai.log("installed")',
    updateURL: 'https://plugins.example/plugin.js',
    versionOfPlugin: '1.0.0',
    ...patch,
  }
}

function streamedResponse(
  chunks: Uint8Array[],
  options: { status?: number; close?: boolean; cancel?: () => void } = {},
): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        if (options.close !== false) controller.close()
      },
      cancel() {
        options.cancel?.()
      },
    }),
    { status: options.status ?? 200 },
  )
}

beforeEach(() => {
  updateMocks.getPluginPermission.mockReset()
  updateMocks.getPluginPermission.mockResolvedValue(true)
  updateMocks.hasher.mockReset()
  updateMocks.hasher.mockImplementation(async (value: Uint8Array) => new TextDecoder().decode(value))
  updateMocks.pluginFetchNative.mockReset()
})

describe('plugin update transport', () => {
  it('binds a range check permission to the exact plugin script and uses the plugin proxy transport', async () => {
    updateMocks.pluginFetchNative.mockResolvedValue(
      new Response('//@version 1.1.0\nRisuai.log("updated")', { status: 206 }),
    )
    const target = plugin({ name: 'bound-plugin', script: 'exact installed source' })

    await expect(checkPluginUpdate(target)).resolves.toEqual({
      status: 'available',
      update: {
        version: '1.1.0',
        updateURL: target.updateURL,
      },
    })

    expect(updateMocks.getPluginPermission).toHaveBeenCalledWith(
      'bound-plugin',
      'pluginUpdate',
      false,
      'exact installed source',
      undefined,
      { updateURL: target.updateURL },
    )
    expect(updateMocks.pluginFetchNative).toHaveBeenCalledWith(target.updateURL, {
      method: 'GET',
      headers: { Range: 'bytes=0-4095' },
      requestTimeoutMs: 30_000,
      sensitive: true,
    })
  })

  it('reports permission denial without making a request', async () => {
    updateMocks.getPluginPermission.mockResolvedValue(false)

    await expect(checkPluginUpdate(plugin({ name: 'denied-plugin' }))).resolves.toEqual({ status: 'denied' })
    expect(updateMocks.pluginFetchNative).not.toHaveBeenCalled()
  })

  it('reports permission storage failures without leaving the check pending', async () => {
    updateMocks.getPluginPermission.mockRejectedValue(new Error('permission store unavailable'))

    await expect(checkPluginUpdate(plugin({ name: 'permission-error-plugin' }))).resolves.toEqual({
      status: 'failed',
    })
    expect(updateMocks.pluginFetchNative).not.toHaveBeenCalled()
  })

  it('revalidates the installed target after permission resolves', async () => {
    let resolvePermission!: (allowed: boolean) => void
    updateMocks.getPluginPermission.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolvePermission = resolve
      }),
    )
    let active = true
    const result = checkPluginUpdate(plugin({ name: 'changed-during-consent' }), () => active)

    await vi.waitFor(() => expect(updateMocks.getPluginPermission).toHaveBeenCalledOnce())
    active = false
    resolvePermission(true)

    await expect(result).resolves.toEqual({ status: 'failed' })
    expect(updateMocks.pluginFetchNative).not.toHaveBeenCalled()
  })

  it('rejects a private update target before prompting or fetching', async () => {
    await expect(
      checkPluginUpdate(plugin({ name: 'private-plugin', updateURL: 'http://127.0.0.1/plugin.js' })),
    ).resolves.toEqual({ status: 'failed' })

    expect(updateMocks.getPluginPermission).not.toHaveBeenCalled()
    expect(updateMocks.pluginFetchNative).not.toHaveBeenCalled()
  })

  it('rejects public HTTP update targets before prompting or fetching', async () => {
    await expect(
      checkPluginUpdate(plugin({ name: 'http-plugin', updateURL: 'http://plugins.example/plugin.js' })),
    ).resolves.toEqual({ status: 'failed' })

    expect(updateMocks.getPluginPermission).not.toHaveBeenCalled()
    expect(updateMocks.pluginFetchNative).not.toHaveBeenCalled()
  })

  it('deduplicates exact-script checks and caches successful up-to-date results', async () => {
    let resolveResponse!: (response: Response) => void
    updateMocks.pluginFetchNative.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve
      }),
    )
    const target = plugin({ name: 'deduped-plugin' })
    const first = checkPluginUpdate(target)
    const second = checkPluginUpdate({ ...target })

    await vi.waitFor(() => expect(updateMocks.pluginFetchNative).toHaveBeenCalledOnce())
    resolveResponse(new Response('//@version 1.0.0', { status: 206 }))
    await expect(Promise.all([first, second])).resolves.toEqual([{ status: 'up-to-date' }, { status: 'up-to-date' }])
    await expect(checkPluginUpdate({ ...target })).resolves.toEqual({ status: 'up-to-date' })
    expect(updateMocks.pluginFetchNative).toHaveBeenCalledOnce()
  })

  it('does not share a cached result across scripts with the same plugin metadata', async () => {
    updateMocks.pluginFetchNative
      .mockResolvedValueOnce(new Response('//@version 1.0.0', { status: 206 }))
      .mockResolvedValueOnce(new Response('//@version 2.0.0', { status: 206 }))
    const target = plugin({ name: 'script-identity-plugin', script: 'first source' })

    await expect(checkPluginUpdate(target)).resolves.toEqual({ status: 'up-to-date' })
    await expect(checkPluginUpdate({ ...target, script: 'second source' })).resolves.toMatchObject({
      status: 'available',
    })
    expect(updateMocks.pluginFetchNative).toHaveBeenCalledTimes(2)
  })

  it('does not treat an embedded version-like string as plugin metadata', async () => {
    updateMocks.pluginFetchNative.mockResolvedValue(
      new Response('const example = "//@version 99.0.0"\nRisuai.log(example)', { status: 206 }),
    )

    await expect(checkPluginUpdate(plugin({ name: 'embedded-version-plugin' }))).resolves.toEqual({
      status: 'up-to-date',
    })
  })

  it('downloads the full source through the same permission-bound transport', async () => {
    updateMocks.pluginFetchNative.mockResolvedValue(new Response('updated source', { status: 200 }))
    const target = plugin({ name: 'download-plugin', script: 'download identity' })

    await expect(downloadPluginUpdate(target)).resolves.toEqual({
      status: 'downloaded',
      source: 'updated source',
    })
    expect(updateMocks.getPluginPermission).toHaveBeenCalledWith(
      'download-plugin',
      'pluginUpdate',
      false,
      'download identity',
      undefined,
      { updateURL: target.updateURL },
    )
    expect(updateMocks.pluginFetchNative).toHaveBeenCalledWith(target.updateURL, {
      method: 'GET',
      requestTimeoutMs: 30_000,
      sensitive: true,
    })
  })

  it('cancels and rejects a full script download beyond the configured cap', async () => {
    const cancel = vi.fn()
    updateMocks.pluginFetchNative.mockResolvedValue(
      streamedResponse([new Uint8Array(PLUGIN_UPDATE_SCRIPT_MAX_BYTES + 1)], { close: false, cancel }),
    )

    await expect(downloadPluginUpdate(plugin({ name: 'oversized-download' }))).resolves.toEqual({
      status: 'failed',
    })
    expect(cancel).toHaveBeenCalledOnce()
  })
})

describe('bounded plugin update reads', () => {
  it('cancels and truncates a range response when the server ignores Range', async () => {
    const cancel = vi.fn()
    const response = streamedResponse([new TextEncoder().encode('//@version 2.0.0\nignored payload')], {
      close: false,
      cancel,
    })

    await expect(readPluginUpdateText(response, 16, true)).resolves.toBe('//@version 2.0.0')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('cancels and rejects a full download that exceeds its byte limit', async () => {
    const cancel = vi.fn()
    const response = streamedResponse([new TextEncoder().encode('1234'), new TextEncoder().encode('5')], {
      close: false,
      cancel,
    })

    await expect(readPluginUpdateText(response, 4, false)).rejects.toThrow(
      'Plugin update response exceeds the allowed size.',
    )
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('preserves UTF-8 characters split across stream chunks', async () => {
    const bytes = new TextEncoder().encode('A한B')
    const response = streamedResponse([bytes.subarray(0, 2), bytes.subarray(2, 3), bytes.subarray(3)])

    await expect(readPluginUpdateText(response, 16, false)).resolves.toBe('A한B')
  })
})
