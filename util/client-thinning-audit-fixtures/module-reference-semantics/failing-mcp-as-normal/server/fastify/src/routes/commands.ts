// AEC5 fixture: chat create, patch, fork sourcePatch, and forked-chat writes all
// validate normal module links, and character module links are validated too.
interface RouteApp {
  post: (route: string, handler: (req: unknown) => unknown) => void
  patch: (route: string, handler: (req: unknown) => unknown) => void
}

declare function validateNormalModuleLinks(modules: unknown[], moduleIds: string[], label: string): void
declare function validateCharacterModuleLinks(modules: unknown[], moduleIds: string[]): void

export function registerCommandRoutes(app: RouteApp): void {
  app.post('/api/v1/commands/chats', async () => {
    const modules: unknown[] = []
    const moduleIds: string[] = []
    validateNormalModuleLinks(modules, moduleIds, 'chat.modules')
    validateCharacterModuleLinks(modules, moduleIds)
    return { ok: true }
  })

  app.patch('/api/v1/commands/chats/:chatId', async () => {
    const modules: unknown[] = []
    const moduleIds: string[] = []
    validateNormalModuleLinks(modules, moduleIds, 'patch.modules')
    return { ok: true }
  })

  app.post('/api/v1/commands/chats/:chatId/fork', async () => {
    const modules: unknown[] = []
    const moduleIds: string[] = []
    validateNormalModuleLinks(modules, moduleIds, 'sourcePatch.modules')
    validateNormalModuleLinks(modules, moduleIds, 'forkedChat.modules')
    return { ok: true }
  })
}
