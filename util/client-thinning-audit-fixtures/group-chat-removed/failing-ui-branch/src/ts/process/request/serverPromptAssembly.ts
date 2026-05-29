// A4R-group-chat-removed fixture (failing-ui-branch): keep-layers intact so only the
// negative half (UI branch) fails.
type Route = { type: 'local' } | { type: 'server' } | { type: 'unsupported'; reason: string }

export function resolveServerPromptAssembly(input: { currentChar: { type?: string } }): Route {
  if ((input.currentChar as { type?: string }).type === 'group') {
    return { type: 'unsupported', reason: 'Group chats are not supported by server prompt assembly.' }
  }
  return { type: 'server' }
}
