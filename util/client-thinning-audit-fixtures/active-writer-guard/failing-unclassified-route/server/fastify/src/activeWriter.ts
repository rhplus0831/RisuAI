// EC5 active-writer classifier needle carrier. In the real tree this is the
// requiresActiveWriter predicate in server/fastify/src/activeWriter.ts; every
// active-writer route rule's needles must appear here.
export function requiresActiveWriter(method: string, path: string): boolean {
  if (path.startsWith('/api/v1/commands/')) return true
  if (path === '/api/v1/import/risusave') return true
  if (path === '/api/v1/assets') return true
  if (path.startsWith('/api/v1/backups')) return true
  if (path === '/api/v1/generate/chat') return true
  if (path === '/api/v1/generate/preview-prompt') return true
  if (path === '/api/v1/memory/jobs') return true
  if (method === 'DELETE' && path.startsWith('/api/v1/memory/jobs/')) return true
  if (path === '/api/v1/storage/write') return true
  if (path === '/api/v1/storage/remove') return true
  return false
}
