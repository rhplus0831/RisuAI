// Invariant: only the central command wrapper may handle conflict retries.
// Other callers must surface conflicts, not replay mutating commands.

interface CommandResult {
  status: 'ok' | 'conflict'
  revision: number
}

async function runServerCommand(_name: string, payload: { baseRevision: number }): Promise<CommandResult> {
  return { status: 'ok', revision: payload.baseRevision + 1 }
}

// Violation: a non-wrapper caller replays a mutating command after conflict.
export async function applyMessageEdit(latestRevision: number): Promise<void> {
  const result = await runServerCommand('chat/update-message', { baseRevision: latestRevision })
  if (result.status === 'conflict') {
    await runServerCommand('chat/update-message', { baseRevision: latestRevision + 1 })
  }
}
