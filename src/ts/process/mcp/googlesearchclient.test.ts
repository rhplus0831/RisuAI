import { beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({
  isFastifyServer: true,
}))
const localForageState = vi.hoisted(() => ({
  getItem: vi.fn(async () => undefined),
  setItem: vi.fn(async () => undefined),
}))
const alertState = vi.hoisted(() => ({
  alertInput: vi.fn(async () => ''),
}))

vi.mock('src/ts/platform', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/platform')>()
  return {
    ...actual,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('../../globalApi.svelte', () => ({
  fetchNative: vi.fn(),
}))

vi.mock('../../alert', () => ({
  alertInput: alertState.alertInput,
}))

vi.mock('localforage', () => ({
  default: {
    createInstance: vi.fn(() => localForageState),
  },
}))

import { GoogleSearchClient } from './googlesearchclient'

beforeEach(() => {
  platformState.isFastifyServer = true
  localForageState.getItem.mockClear()
  localForageState.setItem.mockClear()
  alertState.alertInput.mockClear()
})

describe('Google Search MCP credentials', () => {
  it('does not read or write browser credential storage in server-backed web mode', async () => {
    const client = new GoogleSearchClient()

    await expect(client.checkHandshake()).rejects.toThrow(
      'Google Search MCP credentials are not supported in server-backed web mode yet',
    )

    expect(localForageState.getItem).not.toHaveBeenCalled()
    expect(localForageState.setItem).not.toHaveBeenCalled()
    expect(alertState.alertInput).not.toHaveBeenCalled()
  })
})
