import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DIAGNOSTICS_LIMIT, diagnosticErrorFields, projectDiagnosticEntry } from '@risuai/protocol/diagnostics'

let diagnostics: typeof import('./diagnostics')
let stop: (() => void) | undefined
let fetchMock: ReturnType<typeof vi.fn>
const originalFetch = window.fetch

beforeEach(async () => {
  vi.resetModules()
  sessionStorage.clear()
  fetchMock = vi.fn(
    async () => new Response('PRIVATE RESPONSE', { status: 503, headers: { 'X-Request-UID': 'a'.repeat(64) } }),
  )
  window.fetch = fetchMock as typeof fetch
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  diagnostics = await import('./diagnostics')
})
afterEach(() => {
  stop?.()
  stop = undefined
  window.fetch = originalFetch
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('browser diagnostics', () => {
  it('captures early errors without DevTools and only reveals them after server opt-in', () => {
    stop = diagnostics.initializeClientDiagnostics()
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('PRIVATE PROMPT') }))
    expect(diagnostics.getClientDiagnosticsSnapshot()).toEqual({ enabled: false, entries: [] })
    diagnostics.configureClientDiagnostics({ version: 1 })
    expect(diagnostics.getClientDiagnosticsSnapshot().entries).toContainEqual(
      expect.objectContaining({ event: 'runtime-error', errorName: 'TypeError' }),
    )
    expect(sessionStorage.getItem('risu:diagnostics:v1')).not.toContain('PRIVATE PROMPT')
  })

  it('records HTTP failures and correlation IDs while preserving response bodies and console calls', async () => {
    const originalError = console.error
    stop = diagnostics.initializeClientDiagnostics()
    diagnostics.configureClientDiagnostics({ version: 1 })
    console.error('PRIVATE LOG', { message: 'PRIVATE MESSAGE', apiKey: 'PRIVATE KEY' })
    const response = await window.fetch('/api/v1/characters/PRIVATE-ID?api_key=PRIVATE-KEY', {
      headers: { Authorization: 'PRIVATE AUTH' },
    })
    expect(await response.text()).toBe('PRIVATE RESPONSE')
    expect(originalError).toHaveBeenCalledWith('PRIVATE LOG', { message: 'PRIVATE MESSAGE', apiKey: 'PRIVATE KEY' })
    const snapshot = diagnostics.getClientDiagnosticsSnapshot()
    expect(snapshot.entries).toContainEqual(
      expect.objectContaining({ event: 'http', statusCode: 503, requestUid: 'a'.repeat(64) }),
    )
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE')
    expect(snapshot.entries.some((entry) => entry.routeId?.includes('/'))).toBe(false)
  })

  it('keeps fetch rejection identity and drops invalid UIDs and arbitrary error fields', async () => {
    const error = new TypeError('PRIVATE NETWORK BODY')
    fetchMock.mockRejectedValueOnce(error)
    stop = diagnostics.initializeClientDiagnostics()
    diagnostics.configureClientDiagnostics({ version: 1 })
    await expect(window.fetch('https://PRIVATE.example/prompt')).rejects.toBe(error)
    const record = diagnostics.getClientDiagnosticsSnapshot().entries.at(-1)
    expect(record).toMatchObject({ event: 'network-failure', routeId: 'external', errorName: 'TypeError' })
    expect(JSON.stringify(record)).not.toContain('PRIVATE')
    expect(
      projectDiagnosticEntry({
        timestamp: 1,
        source: 'browser',
        level: 'error',
        event: 'console',
        requestUid: 'private-token',
        errorName: 'PRIVATE MESSAGE',
        message: 'PRIVATE',
        prompt: 'PRIVATE',
      }),
    ).toEqual({ timestamp: 1, source: 'browser', level: 'error', event: 'console' })
  })

  it('restores bounded content-free records across reload, and clears them when opt-in is absent', async () => {
    diagnostics.configureClientDiagnostics({ version: 1 })
    for (let i = 0; i < DIAGNOSTICS_LIMIT + 4; i++)
      diagnostics.recordClientDiagnostic({ event: 'http', level: 'info', durationMs: i })
    vi.resetModules()
    diagnostics = await import('./diagnostics')
    diagnostics.configureClientDiagnostics({ version: 1 })
    const snapshot = diagnostics.getClientDiagnosticsSnapshot()
    expect(snapshot.entries).toHaveLength(DIAGNOSTICS_LIMIT)
    expect(snapshot.entries[0].durationMs).toBe(4)
    diagnostics.configureClientDiagnostics(undefined)
    diagnostics.recordClientDiagnostic({ event: 'runtime-error', level: 'error' })
    expect(diagnostics.getClientDiagnosticsSnapshot()).toEqual({ enabled: false, entries: [] })
    expect(sessionStorage.getItem('risu:diagnostics:v1')).toBeNull()
  })

  it('strips complete multiline error messages, function names, origins and file query strings from stacks', () => {
    const error = new Error('PRIVATE\n at https://private.example/src/PRIVATE.ts:1:2')
    error.stack = `Error: ${error.message}\n at PRIVATE_FUNCTION (https://private.example/src/ts/bootstrap.ts?token=PRIVATE:23:45)\n at privatePlugin (https://private.example/plugins/PRIVATE.js:2:3)`
    expect(diagnosticErrorFields(error)).toEqual({ errorName: 'Error', locations: ['src/ts/bootstrap.ts:23:45'] })
  })
})
