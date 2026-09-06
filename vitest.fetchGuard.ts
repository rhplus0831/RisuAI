export interface UnexpectedPort3000FetchGuard {
  fetch: typeof globalThis.fetch
  takeUnexpectedRequests: () => Error[]
}

const HAPPY_DOM_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function resolveFetchUrl(input: RequestInfo | URL, baseUrl: string): URL | null {
  const value =
    typeof input === 'string' || input instanceof URL
      ? input
      : typeof input === 'object' && input !== null && 'url' in input
        ? input.url
        : String(input)
  try {
    return new URL(value, baseUrl)
  } catch {
    return null
  }
}

export function isUnexpectedHappyDomPort3000Fetch(input: RequestInfo | URL, baseUrl: string): boolean {
  const url = resolveFetchUrl(input, baseUrl)
  return (
    url !== null &&
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.port === '3000' &&
    HAPPY_DOM_LOOPBACK_HOSTS.has(url.hostname)
  )
}

export function createUnexpectedPort3000FetchGuard(
  fallbackFetch: typeof globalThis.fetch,
  baseUrl: () => string,
): UnexpectedPort3000FetchGuard {
  const unexpectedRequests: Error[] = []

  function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = resolveFetchUrl(input, baseUrl())
    if (
      url !== null &&
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.port === '3000' &&
      HAPPY_DOM_LOOPBACK_HOSTS.has(url.hostname)
    ) {
      const error = new Error(
        `Unexpected Happy-DOM fetch to ${url.href}. Stub fetch explicitly and await asynchronous command work before test teardown.`,
      )
      error.name = 'UnexpectedHappyDomFetchError'
      Error.captureStackTrace?.(error, guardedFetch)
      unexpectedRequests.push(error)
      return Promise.reject(error)
    }

    return Reflect.apply(fallbackFetch, globalThis, [input, init]) as Promise<Response>
  }

  return {
    fetch: guardedFetch as typeof globalThis.fetch,
    takeUnexpectedRequests: () => unexpectedRequests.splice(0),
  }
}
