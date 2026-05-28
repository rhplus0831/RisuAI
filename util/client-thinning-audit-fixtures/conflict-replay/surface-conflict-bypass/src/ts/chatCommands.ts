// Accepted: a non-wrapper helper may observe a `status === 'conflict'` result
// but must surface it to the caller (return/throw) instead of replaying the
// mutating command with a refreshed baseRevision.

interface CommandResult {
  status: 'ok' | 'conflict'
  revision: number
}

export async function applyMessageEdit(
  run: () => Promise<CommandResult>,
): Promise<CommandResult> {
  const result = await run()
  if (result.status === 'conflict') {
    return result
  }
  return result
}
