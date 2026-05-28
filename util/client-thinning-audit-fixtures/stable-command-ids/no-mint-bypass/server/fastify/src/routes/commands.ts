// EC4 fixture: command routes resolve durable ids from validated request
// params; they do not mint ids and do not expose promptTemplate through generic
// settings commands.
interface RouteApp {
  post: (route: string, handler: (req: { params: Record<string, unknown> }) => unknown) => void
}

export function registerCommandRoutes(app: RouteApp): void {
  app.post('/api/v1/commands/chats/:chatId', async (req) => {
    const chatId = String(req.params.chatId ?? '')
    return { ok: true, chatId }
  })
}
