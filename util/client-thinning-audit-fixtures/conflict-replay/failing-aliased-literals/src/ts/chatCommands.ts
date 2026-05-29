// Adversarial variant of the A4R2 conflict-replay anti-pattern. The conflict
// status and the `baseRevision` payload key are aliased to module-level
// constants, so the `applyMessageEdit` body no longer contains the bare
// `'conflict'` / `'baseRevision'` substrings the old heuristic keyed on. The
// function still blindly replays the mutating command on a conflict, so the
// hardened AST rule must reject it.

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
