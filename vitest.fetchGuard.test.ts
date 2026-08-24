import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createUnexpectedPort3000FetchGuard,
  isUnexpectedHappyDomPort3000Fetch,
  resolveFetchUrl,
} from './vitest.fetchGuard'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Happy-DOM port 3000 fetch guard', () => {
  it.each([
    '/api/v1/bootstrap',
    'http://localhost:3000/api/v1/bootstrap',
    'http://127.0.0.1:3000/api/v1/bootstrap',
    'http://[::1]:3000/api/v1/bootstrap',
  ])('recognizes an unexpected loopback request: %s', (input) => {
    expect(isUnexpectedHappyDomPort3000Fetch(input, 'http://localhost:3000/')).toBe(true)
  })

  it.each([
    'http://localhost:3001/api/v1/bootstrap',
    'https://example.com:3000/api/v1/bootstrap',
    'ws://localhost:3000/api/v1/proxy/stream-jobs/example/ws',
  ])('allows a request outside the accidental Happy-DOM fetch boundary: %s', (input) => {
    expect(isUnexpectedHappyDomPort3000Fetch(input, 'http://localhost:3000/')).toBe(false)
  })

  it('resolves Request inputs and relative paths against the DOM origin', () => {
    expect(resolveFetchUrl(new Request('http://127.0.0.1:3000/request'), 'https://example.com/')?.href).toBe(
      'http://127.0.0.1:3000/request',
    )
    expect(resolveFetchUrl('/relative', 'http://localhost:3000/')?.href).toBe('http://localhost:3000/relative')
  })

  it('rejects before network access and preserves the originating call stack', async () => {
    const fallbackFetch = vi.fn(async () => new Response('{}')) as unknown as typeof fetch
    const guard = createUnexpectedPort3000FetchGuard(fallbackFetch, () => 'http://localhost:3000/')

    async function callFromFocusedTest(): Promise<Response> {
      return guard.fetch('/api/v1/commands/characters/select')
    }

    await expect(callFromFocusedTest()).rejects.toThrow('Unexpected Happy-DOM fetch')
    expect(fallbackFetch).not.toHaveBeenCalled()
    const [error] = guard.takeUnexpectedRequests()
    expect(error?.stack).toContain('callFromFocusedTest')
  })

  it('forwards allowed requests to the captured fetch implementation', async () => {
    const response = new Response('{}')
    const fallbackFetch = vi.fn(async () => response) as unknown as typeof fetch
    const guard = createUnexpectedPort3000FetchGuard(fallbackFetch, () => 'http://localhost:3000/')

    await expect(guard.fetch('https://example.com/api')).resolves.toBe(response)
    expect(fallbackFetch).toHaveBeenCalledWith('https://example.com/api', undefined)
    expect(guard.takeUnexpectedRequests()).toEqual([])
  })

  it('is restored after a per-test global fetch stub is removed', () => {
    const guardedBaseline = globalThis.fetch
    const testFetch = vi.fn()

    vi.stubGlobal('fetch', testFetch)
    expect(globalThis.fetch).toBe(testFetch)

    vi.unstubAllGlobals()
    expect(globalThis.fetch).toBe(guardedBaseline)
  })
})
