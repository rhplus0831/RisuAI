// Invariant: read-only projection refresh helpers never attach the active-writer
// session header; only writer-intent bootstrap registers ownership.

function activeWriterSessionHeader(extra?: Record<string, string>): Record<string, string> {
  return { 'x-risu-writer': 'session', ...extra }
}

async function requestBootstrap(_opts: { registerActiveWriter: boolean }): Promise<unknown> {
  return {}
}

// Writer-intent bootstrap: classified writer-mode via `registerActiveWriter: true`.
export async function fetchServerBootstrapProjection(): Promise<unknown> {
  return requestBootstrap({ registerActiveWriter: true })
}

// Anti-pattern: a read-only refresh helper still attaches the writer session
// header, so a passive refresh would register writer ownership.
export async function refreshServerProjection(): Promise<unknown> {
  const headers = activeWriterSessionHeader({ 'x-refresh': '1' })
  const response = await fetch('/api/v1/bootstrap', { headers })
  return response.json()
}
