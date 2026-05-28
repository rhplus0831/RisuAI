// The central command wrapper IS the conflict surface. A4R2 exempts
// runServerCommand in src/ts/server/commands.ts, so it may observe a
// `status === 'conflict'` result and refresh baseRevision before re-issuing
// through the same controlled path. The same body in any other function would
// fail the rule.

interface CommandResult {
  status: 'ok' | 'conflict'
  revision: number
}

export async function runServerCommand(url: string, baseRevision: number): Promise<CommandResult> {
  const first = await fetch(url, { method: 'POST', body: JSON.stringify({ baseRevision }) })
  let result = (await first.json()) as CommandResult
  if (result.status === 'conflict') {
    const retried = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ baseRevision: result.revision }),
    })
    result = (await retried.json()) as CommandResult
  }
  return result
}
