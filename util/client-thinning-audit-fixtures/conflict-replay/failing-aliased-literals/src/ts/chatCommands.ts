// Invariant: conflict replay detection follows aliases for the conflict status
// and baseRevision key, not just bare string literals.

const CONFLICT_STATUS = 'conflict'
const REVISION_KEY = 'baseRevision'

interface CommandResult {
  status: 'ok' | 'conflict'
  revision: number
}

async function runServerCommand(
  _name: string,
  payload: Record<string, number>,
): Promise<CommandResult> {
  return { status: 'ok', revision: (payload[REVISION_KEY] ?? 0) + 1 }
}

export async function applyMessageEdit(latestRevision: number): Promise<void> {
  const result = await runServerCommand('chat/update-message', { [REVISION_KEY]: latestRevision })
  if (result.status === CONFLICT_STATUS) {
    await runServerCommand('chat/update-message', { [REVISION_KEY]: latestRevision + 1 })
  }
}
