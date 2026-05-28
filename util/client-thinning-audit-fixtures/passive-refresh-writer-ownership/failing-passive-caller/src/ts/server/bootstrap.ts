// Minimal fixture for the A4R1 passive refresh writer ownership rule. The real
// helpers live in src/ts/server/bootstrap.ts. The writer-intent helper attaches
// the active-writer session header; only the page-load entrypoint
// (src/ts/bootstrap.ts, in WRITER_BOOTSTRAP_CALLERS) may call it. Passive,
// event-driven refresh paths must use the read-only helper.

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
