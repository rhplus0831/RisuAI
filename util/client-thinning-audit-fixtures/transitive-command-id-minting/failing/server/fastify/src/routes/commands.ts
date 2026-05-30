// Invariant: command routes use durable ids from validated requests and never
// mint them on the command path, directly or transitively.
import { randomUUID } from 'node:crypto'
import { createChatRecord } from '../commands/chats.js'

interface RouteApp {
  post: (route: string, handler: (req: { body: Record<string, unknown> }) => unknown) => void
}

export function registerCommandRoutes(app: RouteApp): void {
  // Anti-pattern A: the route handler mints a durable id directly.
  app.post('/api/v1/commands/messages', async (req) => {
    const id = randomUUID()
    return { id, text: req.body.text ?? '' }
  })

  // Anti-pattern B: the route handler delegates to a command-path helper that
  // transitively mints a durable id from request-derived data.
  app.post('/api/v1/commands/chats', async (req) => {
    const record = createChatRecord(String(req.body.name ?? ''))
    return { record }
  })
}
