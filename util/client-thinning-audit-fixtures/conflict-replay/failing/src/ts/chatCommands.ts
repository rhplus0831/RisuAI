// Minimal fixture for the A4R2 conflict replay rule. The real central wrapper
// is runServerCommand in src/ts/server/commands.ts, and it is the ONLY function
// allowed to observe a `status === 'conflict'` result. Every other caller must
// surface the conflict, never replay the mutating command.

interface CommandResult {
  status: 'ok' | 'conflict'
  revision: number
}

async function runServerCommand(
  _name: string,
  payload: { baseRevision: number },
): Promise<CommandResult> {
  return { status: 'ok', revision: payload.baseRevision + 1 }
}

// Anti-pattern: branch on a conflict result and blindly replay the mutating
// command with a bumped baseRevision instead of surfacing the conflict.
export async function applyMessageEdit(latestRevision: number): Promise<void> {
  const result = await runServerCommand('chat/update-message', { baseRevision: latestRevision })
  if (result.status === 'conflict') {
    await runServerCommand('chat/update-message', { baseRevision: latestRevision + 1 })
  }
}
