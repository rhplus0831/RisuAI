// Minimal fixture for the A4R1 passive refresh writer ownership rule. The real
// helpers live in src/ts/server/bootstrap.ts. The writer-intent / read-only
// split is the accepted shape: the writer helper attaches the active-writer
// session header and is only called from the page-load entrypoint
// (src/ts/bootstrap.ts, in WRITER_BOOTSTRAP_CALLERS); the refresh helper stays
// read-only.

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
