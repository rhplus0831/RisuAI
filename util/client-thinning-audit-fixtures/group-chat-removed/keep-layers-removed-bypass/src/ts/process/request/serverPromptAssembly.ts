// Violation: prompt assembly routes surviving group characters to the server.
type Route = { type: 'local' } | { type: 'server' } | { type: 'unsupported'; reason: string }

export function resolveServerPromptAssembly(_input: { currentChar: { type?: string } }): Route {
  return { type: 'server' }
}
