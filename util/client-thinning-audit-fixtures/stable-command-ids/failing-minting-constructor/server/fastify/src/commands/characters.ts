import { randomUUID } from 'node:crypto'

// Anti-pattern: a command-path constructor mints a durable id instead of
// rejecting a missing/duplicate stable id supplied by the request.
export function createCharacterRecord(input: { chaId?: string }): { chaId: string } {
  return { chaId: input.chaId ?? randomUUID() }
}
