// Accepted: non-wrapper helpers may observe conflicts only to surface them.

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
