// Invariant: command routes use durable ids from validated requests and never
// mint them on the command path, directly or transitively.
import { ensureCharacterChats, requireCharacter } from '../commands/chats.js'

interface RouteApp {
  patch: (
    route: string,
    handler: (req: { params: Record<string, unknown> }) => unknown,
  ) => void
}

export function registerCommandRoutes(app: RouteApp): void {
  // Accepted: the durable id comes from the request, while repair-on-read only
  // receives a persisted-state binding.
  app.patch('/api/v1/commands/chats/:chatId', async (req) => {
    const chatId = String(req.params.chatId ?? '')
    const character = requireCharacter(chatId)
    ensureCharacterChats(character)
    return { ok: true, chatId }
  })
}
