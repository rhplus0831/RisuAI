// EC5 route surface. Every rule in the audit's MUTATING_ROUTE_RULES table must
// match at least one discovered route here, and every mutating route must
// classify (be guarded or explicitly exempt).

interface RouteApp {
  get: (route: string, handler: unknown) => void
  post: (route: string, handler: unknown) => void
  patch: (route: string, handler: unknown) => void
  put: (route: string, handler: unknown) => void
  delete: (route: string, handler: unknown) => void
}

const noop = (): void => {}

export function registerRoutes(app: RouteApp): void {
  // Active-writer guarded mutation routes.
  app.post('/api/v1/commands/settings', noop)
  app.post('/api/v1/import/risusave', noop)
  app.post('/api/v1/assets', noop)
  app.post('/api/v1/backups', noop)
  app.post('/api/v1/generate/chat', noop)
  app.post('/api/v1/generate/preview-prompt', noop)
  app.post('/api/v1/memory/jobs', noop)
  app.delete('/api/v1/memory/jobs/:id', noop)
  app.post('/api/v1/storage/write', noop)
  app.post('/api/v1/storage/remove', noop)
  // Auth/session writes (auth-session) + stateless helper.
  app.post('/api/v1/auth/setup', noop)
  app.post('/api/v1/auth/login', noop)
  app.post('/api/v1/auth/crypto', noop)
  // Read-only POST + runtime routes (explicitly exempt classifications).
  app.post('/api/v1/assets/exists', noop)
  app.post('/api/v1/generate/completion', noop)
  app.post('/api/v1/proxy/fetch', noop)
  app.post('/api/v1/proxy/stream-jobs', noop)
  app.delete('/api/v1/proxy/stream-jobs/:id', noop)
  app.post('/api/v1/hub/sync', noop)
}
