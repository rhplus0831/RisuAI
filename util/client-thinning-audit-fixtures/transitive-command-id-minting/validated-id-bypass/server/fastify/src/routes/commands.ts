// Minimal fixture for the A4R3 transitive command-path id minting rule. The
// real command routes live in server/fastify/src/routes/commands.ts. Durable
// ids must be supplied by the validated request and never minted on the
// command path, directly or transitively.
import { ensureCharacterChats, requireCharacter } from '../commands/chats.js'

interface RouteApp {
  patch: (
    route: string,
    handler: (req: { params: Record<string, unknown> }) => unknown,
  ) => void
}

export function registerCommandRoutes(app: RouteApp): void {
  // Accepted: the durable id comes from the validated request param, and the
  // only normalize-on-read helper receives a persisted-state binding
  // (`character`), so its repair-on-read minting never touches request data.
  app.patch('/api/v1/commands/chats/:chatId', async (req) => {
    const chatId = String(req.params.chatId ?? '')
    const character = requireCharacter(chatId)
    ensureCharacterChats(character)
    return { ok: true, chatId }
  })
}
