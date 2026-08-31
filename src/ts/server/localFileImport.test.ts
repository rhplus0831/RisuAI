import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => vi.fn(async () => 'auth-token'))
const getBaseRevision = vi.hoisted(() => vi.fn(async () => 7))
const setRevision = vi.hoisted(() => vi.fn())
const reconcileEvent = vi.hoisted(() => vi.fn(async () => {}))
const handleStaleWriter = vi.hoisted(() => vi.fn(() => false))

vi.mock('../storage/fastifyStorage', () => ({ getNodeServerProxyAuth: auth }))

vi.mock('./activeWriterSession', () => ({
  activeWriterSessionHeader: () => ({ 'risu-writer-session': 'writer-a' }),
  handleActiveWriterStaleResponse: handleStaleWriter,
}))

vi.mock('./commands', () => ({
  getServerCommandBaseRevision: getBaseRevision,
  setCachedServerCommandRevision: setRevision,
  withDirectServerCommandEventReconciliation: async (
    _matches: (event: unknown) => boolean,
    operation: (reconcile: typeof reconcileEvent) => Promise<unknown>,
  ) => operation(reconcileEvent),
}))

import { importLocalCharacterFileFromServer, importLocalModuleFileFromServer } from './localFileImport'

beforeEach(() => {
  auth.mockClear()
  getBaseRevision.mockClear()
  setRevision.mockClear()
  reconcileEvent.mockClear()
  handleStaleWriter.mockClear()
  vi.unstubAllGlobals()
})

describe('local file import client', () => {
  it('sends one multipart character file and reconciles the server-created event', async () => {
    const event = { type: 'character.created', resource: 'character', revision: 8, id: 'character-a' }
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            revision: 8,
            event,
            characterId: 'character-a',
            importReport: { droppedArchiveEntries: [], droppedInlineAssets: [] },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' })

    await expect(importLocalCharacterFileFromServer({ file, fileName: 'bot.charx' })).resolves.toMatchObject({
      status: 'ok',
      characterId: 'character-a',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/import/character-card?baseRevision=7')
    expect(init.headers).toMatchObject({ 'risu-auth': 'auth-token', 'risu-writer-session': 'writer-a' })
    expect(init.headers).not.toHaveProperty('content-type')
    const form = init.body as FormData
    const uploaded = form.get('file') as File
    expect(uploaded.name).toBe('bot.charx')
    expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(setRevision).toHaveBeenCalledWith(8)
    expect(reconcileEvent).toHaveBeenCalledWith(event)
  })

  it('retries a challenged module with JSON metadata and no second file upload', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'low_level_access_confirmation_required',
            pendingImportToken: 'pending-token',
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            revision: 8,
            event: { type: 'module.created', resource: 'moduleCreated', revision: 8, id: 'module-a' },
            moduleId: 'module-a',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const challenged = await importLocalModuleFileFromServer({
      file: new Blob([new Uint8Array([4, 5, 6])]),
      fileName: 'module.risum',
    })
    expect(challenged).toEqual({ status: 'low-level-access', pendingImportToken: 'pending-token' })

    await expect(
      importLocalModuleFileFromServer({ pendingImportToken: 'pending-token', allowLowLevelAccess: true }),
    ).resolves.toMatchObject({ status: 'ok', moduleId: 'module-a' })

    const [retryUrl, retryInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(retryUrl).toBe('/api/v1/import/module')
    expect(retryInit.headers).toMatchObject({ 'content-type': 'application/json' })
    expect(JSON.parse(String(retryInit.body))).toEqual({
      baseRevision: 7,
      pendingImportToken: 'pending-token',
      allowLowLevelAccess: true,
    })
  })
})
