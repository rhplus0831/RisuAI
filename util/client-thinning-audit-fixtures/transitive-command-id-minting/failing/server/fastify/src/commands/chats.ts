import { randomUUID } from 'node:crypto'

function mintChatId(): string {
  return randomUUID()
}

export function createChatRecord(name: string): {
  id: string
  name: string
  message: unknown[]
} {
  // Anti-pattern: a command-path helper mints a durable id transitively instead
  // of rejecting a missing id at the validator boundary.
  return { id: mintChatId(), name, message: [] }
}
