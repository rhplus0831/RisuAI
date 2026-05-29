// Minimal stand-in for the real command family. The audit discovers the
// exported `dispatch*` helpers here and treats them as mutating dispatchers
// for the fan-out scan.

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
