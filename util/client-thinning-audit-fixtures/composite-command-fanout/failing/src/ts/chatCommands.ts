// Invariant: exported `dispatch*` helpers are mutating dispatchers for fan-out detection.

export async function runServerCommand(_name: string, _payload: unknown): Promise<void> {
  // Stand-in for the central optimistic command runner.
}

export async function dispatchAppendMessage(message: string): Promise<void> {
  await runServerCommand('chat/append-message', { message })
}

export async function dispatchUpdateMessage(id: string, message: string): Promise<void> {
  await runServerCommand('chat/update-message', { id, message })
}

export async function runChatCommandSequence(steps: Array<() => Promise<void>>): Promise<void> {
  for (const step of steps) await step()
}
