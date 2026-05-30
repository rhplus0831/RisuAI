// The central command wrapper is the only allowed conflict retry surface.

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
