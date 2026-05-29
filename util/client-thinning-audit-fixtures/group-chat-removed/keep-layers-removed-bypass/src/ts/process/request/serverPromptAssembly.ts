// A4R-group-chat-removed fixture (bypass): the server-side group hard-fail was
// removed, so a surviving group character would route to server assembly.
type Route = { type: 'local' } | { type: 'server' } | { type: 'unsupported'; reason: string }

export function resolveServerPromptAssembly(_input: { currentChar: { type?: string } }): Route {
  return { type: 'server' }
}
