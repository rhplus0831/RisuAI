// Invariant: only writer-intent bootstrap callers attach the active-writer
// session header; passive refresh paths use the read-only helper.

function activeWriterSessionHeader(): Record<string, string> {
  return { 'x-risu-writer': 'session' }
}

// Writer-intent bootstrap: registers active-writer ownership.
export async function fetchServerBootstrapProjection(): Promise<unknown> {
  const headers = { ...activeWriterSessionHeader() }
  const response = await fetch('/api/v1/bootstrap', { headers })
  return response.json()
}

// Read-only refresh: the projection-refresh counterpart, no writer header.
export async function refreshServerProjection(): Promise<unknown> {
  const response = await fetch('/api/v1/bootstrap', { headers: {} })
  return response.json()
}
