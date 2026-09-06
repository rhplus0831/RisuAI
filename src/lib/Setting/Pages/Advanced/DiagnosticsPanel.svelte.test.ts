import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ download: vi.fn(async (_name: string, _bytes: Uint8Array) => {}) }))
vi.mock('src/ts/globalApi.svelte', () => ({ downloadFile: mocks.download }))
vi.mock('src/ts/storage/fastifyStorage', () => ({ getNodeServerProxyAuth: async () => 'PRIVATE-AUTH' }))
import { language } from 'src/lang'
import { configureClientDiagnostics, recordClientDiagnostic } from 'src/ts/diagnostics'
import DiagnosticsPanel from './DiagnosticsPanel.svelte'

let target: HTMLElement
let component: ReturnType<typeof mount> | undefined
let fetchMock: ReturnType<typeof vi.fn>
const serverEvent = {
  timestamp: 2,
  source: 'server',
  level: 'error',
  event: 'http',
  routeId: 'bootstrap',
  statusCode: 500,
  requestUid: 'b'.repeat(64),
}

function button(label: string): HTMLButtonElement {
  const result = Array.from(target.querySelectorAll('button')).find((element) => element.textContent?.includes(label))
  if (!result) throw new Error(`Missing button: ${label}`)
  return result
}

beforeEach(() => {
  configureClientDiagnostics(undefined)
  sessionStorage.clear()
  configureClientDiagnostics({ version: 1 })
  mocks.download.mockClear()
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ version: 1, enabled: true, entries: [serverEvent] })))
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(async () => {
  if (component) await unmount(component)
  component = undefined
  target.remove()
  configureClientDiagnostics(undefined)
  vi.unstubAllGlobals()
})

describe('DiagnosticsPanel', () => {
  it('shows recent browser/server events and exports their content-free text with an authenticated read', async () => {
    recordClientDiagnostic({ event: 'console', level: 'warn', message: 'PRIVATE-MESSAGE', prompt: 'PRIVATE-PROMPT' })
    component = mount(DiagnosticsPanel, { target })
    await vi.waitFor(() => expect(target.textContent).toContain('500'))
    await vi.waitFor(() => expect(button(language.diagnostics.download).disabled).toBe(false))
    expect(target.textContent).toContain('500')
    expect(target.textContent).toContain('console')
    button(language.diagnostics.download).click()
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledOnce())
    const [name, bytes] = mocks.download.mock.calls[0]
    const report = new TextDecoder().decode(bytes)
    expect(name).toBe('risuai-diagnostics.txt')
    expect(report).toContain('RisuAI diagnostic report v1')
    expect(report).toContain('500')
    expect(report).toContain('b'.repeat(64))
    expect(report).not.toContain('PRIVATE')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/diagnostics',
      expect.objectContaining({ cache: 'no-store', headers: { 'risu-auth': 'PRIVATE-AUTH' } }),
    )
  })

  it('keeps local export available offline and supplies manual copy text when the clipboard is unavailable', async () => {
    recordClientDiagnostic({ event: 'offline', level: 'warn' })
    fetchMock.mockRejectedValue(new Error('PRIVATE NETWORK ERROR'))
    component = mount(DiagnosticsPanel, { target })
    await vi.waitFor(() => expect(target.textContent).toContain(language.diagnostics.serverUnavailable))
    await vi.waitFor(() => expect(button(language.diagnostics.copy).disabled).toBe(false))
    button(language.diagnostics.copy).click()
    await vi.waitFor(() => expect(target.textContent).toContain(language.diagnostics.copyFallback))
    const report = target.querySelector('textarea')!
    expect(report.readOnly).toBe(true)
    expect(report.value).toContain('offline')
    expect(report.value).toContain('Server diagnostics: unavailable')
    expect(report.value).not.toContain('PRIVATE')
  })

  it('does not request logs when disabled and removes loaded reports when authorization is discarded', async () => {
    configureClientDiagnostics(undefined)
    component = mount(DiagnosticsPanel, { target })
    await tick()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(target.textContent).toContain(language.diagnostics.disabled)
    configureClientDiagnostics({ version: 1 })
    await tick()
    button(language.diagnostics.copy).click()
    await vi.waitFor(() => expect(target.querySelector('textarea')).not.toBeNull())
    configureClientDiagnostics(undefined)
    await tick()
    expect(target.querySelector('textarea')).toBeNull()
    expect(target.textContent).not.toContain('b'.repeat(64))
  })

  it('rejects server records containing unknown content fields', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ version: 1, enabled: true, entries: [{ ...serverEvent, prompt: 'PRIVATE-PROMPT' }] }),
      ),
    )
    component = mount(DiagnosticsPanel, { target })
    await vi.waitFor(() => expect(target.textContent).toContain(language.diagnostics.serverUnavailable))
    expect(target.textContent).not.toContain('PRIVATE-PROMPT')
    expect(target.textContent).not.toContain('b'.repeat(64))
  })
})
