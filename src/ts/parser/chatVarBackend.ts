/**
 * DI seam for chat variable storage so the parser and `calcString` can be
 * imported on the server without pulling Svelte runes / `DBState`.
 *
 * The browser registers `chatVar.svelte`'s DBState-backed functions at module
 * load time. The server registers a request-scoped Map-backed implementation.
 * Callers (parser, `infunctions.ts`, `cbs.ts` via `registerCBS`) use the
 * pass-through getters here.
 *
 * Calling a getter before `setChatVarBackend` has been invoked throws —
 * loud-fail is preferred to silent fallback because the parser's `#when`
 * evaluator depends on a real backing store, and any silent "" / "null"
 * default would mask the registration bug.
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
