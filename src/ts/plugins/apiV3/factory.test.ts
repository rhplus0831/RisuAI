import { afterEach, describe, expect, it, vi } from 'vitest'

import { SandboxHost } from './factory'

function messageCalls(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.filter((call) => call[0] === 'message')
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('SandboxHost lifecycle', () => {
  it('M7: terminate invokes the stored run cleanup once and removes the window message listener', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const host = new SandboxHost({})

    const cleanup = host.run(iframe, '')

    expect(messageCalls(addSpy)).toHaveLength(1)
    expect(document.body.contains(iframe)).toBe(true)

    host.terminate()
    host.terminate()
    cleanup()

    expect(messageCalls(removeSpy)).toHaveLength(1)
    expect(document.body.contains(iframe)).toBe(false)
  })

  it('M7: run failure removes the window message listener and iframe', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    Object.defineProperty(iframe, 'srcdoc', {
      configurable: true,
      set() {
        throw new Error('srcdoc failed')
      },
    })
    const host = new SandboxHost({})

    expect(() => host.run(iframe, '')).toThrow('srcdoc failed')

    expect(messageCalls(removeSpy)).toHaveLength(1)
    expect(document.body.contains(iframe)).toBe(false)
  })

  it('L44: guest RPC calls do not log request response payloads or transferables by default', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const ping = vi.fn(async () => 'pong')
    const host = new SandboxHost({ ping })

    host.run(iframe, '')
    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframe.contentWindow,
        data: {
          type: 'CALL_ROOT',
          reqId: 'req-1',
          method: 'ping',
          args: [],
        },
      }),
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(ping).toHaveBeenCalledTimes(1)
    expect(logSpy).not.toHaveBeenCalled()
  })
})
