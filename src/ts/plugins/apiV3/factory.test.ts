import { afterEach, describe, expect, it, vi } from 'vitest'

import { SandboxHost, V3_GUARD_CSP, V3_SANDBOX_CSP } from './factory'

function messageCalls(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.filter((call) => call[0] === 'message')
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('SandboxHost lifecycle', () => {
  it('removes CSP-addressable subresource egress without a reusable script nonce', () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const host = new SandboxHost({})

    host.run(iframe, '')

    expect(iframe.getAttribute('csp')).toBe(V3_GUARD_CSP)
    expect(V3_GUARD_CSP).toContain("frame-src 'none'")
    expect(iframe.srcdoc).toContain("guest.sandbox.add('allow-scripts')")
    expect(iframe.srcdoc).toContain("guest.setAttribute('csp'")
    expect(iframe.srcdoc).toContain('seenTransferables')
    expect(iframe.srcdoc).toContain("typeof ReadableStream !== 'undefined'")
    expect(V3_SANDBOX_CSP).toContain("connect-src 'none'")
    expect(V3_SANDBOX_CSP).toContain("script-src 'unsafe-inline' 'wasm-unsafe-eval'")
    expect(V3_SANDBOX_CSP).toContain('img-src data: blob:')
    expect(V3_SANDBOX_CSP).toContain("form-action 'none'")
    expect(V3_SANDBOX_CSP).toContain("navigate-to 'none'")
    expect(V3_SANDBOX_CSP).not.toMatch(/https?:|\*|nonce-/)
    expect(iframe.srcdoc).not.toMatch(/<script[^>]+(?:nonce|src)=/i)
    expect(iframe.sandbox.contains('allow-same-origin')).toBe(true)
    expect(iframe.sandbox.contains('allow-downloads')).toBe(false)
  })

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

  it('deduplicates shared transferables and tolerates cyclic RPC results', async () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const buffer = new ArrayBuffer(16)
    const result: Record<string, unknown> = {
      first: new Uint8Array(buffer),
      second: new Uint16Array(buffer),
    }
    result.self = result
    const host = new SandboxHost({ getResult: () => result })
    host.run(iframe, '')
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => undefined)

    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframe.contentWindow,
        data: {
          type: 'CALL_ROOT',
          reqId: 'cyclic-transferables',
          method: 'getResult',
          args: [],
        },
      }),
    )

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalled())
    const responseCall = postMessage.mock.calls.find(
      (call) => (call[0] as { reqId?: string }).reqId === 'cyclic-transferables',
    )
    expect((responseCall as unknown[] | undefined)?.[2]).toEqual([buffer])
  })

  it('rejects a pending iframe execution when the sandbox terminates', async () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const host = new SandboxHost({})

    host.run(iframe, '')
    const execution = host.executeInIframe('await new Promise(() => {})')
    const rejection = expect(execution).rejects.toThrow('Sandbox host terminated')

    host.terminate()

    await rejection
  })

  it('rejects a pending guest callback and removes its forwarded abort listener on terminate', async () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    let callback: ((signal: AbortSignal) => Promise<unknown>) | undefined
    const registerCallback = vi.fn(async (value: typeof callback) => {
      callback = value
    })
    const host = new SandboxHost({ registerCallback })

    host.run(iframe, '')
    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframe.contentWindow,
        data: {
          type: 'CALL_ROOT',
          reqId: 'register-callback',
          method: 'registerCallback',
          args: [{ __type: 'CALLBACK_REF', id: 'guest-callback' }],
        },
      }),
    )
    await vi.waitFor(() => expect(callback).toBeTypeOf('function'))

    const abortController = new AbortController()
    const removeAbortSpy = vi.spyOn(abortController.signal, 'removeEventListener')
    const callbackResult = callback!(abortController.signal)
    const rejection = expect(callbackResult).rejects.toThrow('Sandbox host terminated')

    host.terminate()

    await rejection
    expect(removeAbortSpy).toHaveBeenCalledWith('abort', expect.any(Function))
    await expect(callback!(new AbortController().signal)).rejects.toThrow('Sandbox host terminated')
  })

  it('aborts and releases guest-forwarded host signals on terminate', async () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    let forwardedSignal: AbortSignal | undefined
    let finishRequest: (() => void) | undefined
    const waitForAbort = vi.fn(async (options: { signal: AbortSignal }) => {
      forwardedSignal = options.signal
      await new Promise<void>((resolve) => {
        finishRequest = resolve
      })
    })
    const host = new SandboxHost({ waitForAbort })

    host.run(iframe, '')
    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframe.contentWindow,
        data: {
          type: 'CALL_ROOT',
          reqId: 'forward-abort',
          method: 'waitForAbort',
          args: [
            {
              signal: {
                __type: 'ABORT_SIGNAL_REF',
                abortId: 'guest-abort',
                aborted: false,
              },
            },
          ],
        },
      }),
    )
    await vi.waitFor(() => expect(forwardedSignal).toBeInstanceOf(AbortSignal))
    expect(forwardedSignal?.aborted).toBe(false)

    host.terminate()

    expect(forwardedSignal?.aborted).toBe(true)
    finishRequest?.()
  })
})
