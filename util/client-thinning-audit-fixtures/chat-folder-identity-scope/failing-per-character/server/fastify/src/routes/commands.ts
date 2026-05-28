// AEC4 fixture: chat folder create surfaces reject ids already used by ANY
// character (global duplicate-id rejection), not just within one character.
interface RouteApp {
  post: (route: string, handler: (req: unknown) => unknown) => void
}

declare function chatFolderIdExists(characters: unknown[], id: string): boolean

export function registerCommandRoutes(app: RouteApp): void {
  app.post('/api/v1/commands/chat-folders', async () => {
    const characters: unknown[] = []
    const folder = { id: 'folder-a' }
    if (chatFolderIdExists(characters, folder.id)) {
      throw new Error('duplicate chat folder id')
    }
    return { ok: true }
  })

  app.post('/api/v1/commands/chats/:chatId/folder', async () => {
    const characters: unknown[] = []
    const folder = { id: 'folder-b' }
    if (chatFolderIdExists(characters, folder.id)) {
      throw new Error('duplicate chat folder id')
    }
    return { ok: true }
  })
}
