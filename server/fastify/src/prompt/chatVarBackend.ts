/**
 * Fastify-local DI seam for request-scoped chat variable storage.
 *
 * Calling an accessor before registration throws so prompt parsing cannot
 * silently continue without its request-local backing store.
 */
export interface ChatVarBackend {
  getChatVar: (key: string) => string
  setChatVar: (key: string, value: string) => void
  getGlobalChatVar: (key: string) => string
}

let backend: ChatVarBackend | null = null

export function setChatVarBackend(impl: ChatVarBackend): void {
  backend = impl
}

export function getChatVar(key: string): string {
  if (!backend) {
    throw new Error('chatVar backend not registered')
  }
  return backend.getChatVar(key)
}

export function setChatVar(key: string, value: string): void {
  if (!backend) {
    throw new Error('chatVar backend not registered')
  }
  backend.setChatVar(key, value)
}

export function getGlobalChatVar(key: string): string {
  if (!backend) {
    throw new Error('chatVar backend not registered')
  }
  return backend.getGlobalChatVar(key)
}
