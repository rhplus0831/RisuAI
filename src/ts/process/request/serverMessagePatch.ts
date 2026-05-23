import type { Chat, Message } from '../../storage/database.svelte'
import type { ServerChatMessageMutation, ServerChatMessagePatch } from './serverChatEvents'

function cloneMessage(message: Message): Message {
  return structuredClone(message)
}

function cloneMessages(messages: Message[]): Message[] {
  return structuredClone(messages)
}

function sameMessageContent(a: Message | undefined, b: Message): boolean {
  return a?.role === b.role && a.data === b.data && (a.name ?? null) === (b.name ?? null)
}

function applyMessageMutation(chat: Chat, mutation: ServerChatMessageMutation): void {
  if (mutation.type === 'replace_all') {
    chat.message = cloneMessages(mutation.messages)
    return
  }

  const next = cloneMessage(mutation.message)
  const existing = chat.message[mutation.index]
  if (sameMessageContent(existing, next)) {
    chat.message[mutation.index] = next
    return
  }
  if (mutation.index >= chat.message.length) {
    chat.message.push(next)
    return
  }
  chat.message.splice(mutation.index, 0, next)
}

export function applyServerMessagePatch(chat: Chat, patch: ServerChatMessagePatch): void {
  chat.message ??= []
  for (const mutation of patch.messageMutations) {
    applyMessageMutation(chat, mutation)
  }

  if (patch.chatVarMutations.length === 0) return
  chat.scriptstate ??= {}
  for (const mutation of patch.chatVarMutations) {
    if (mutation.after === null) {
      delete chat.scriptstate[mutation.key]
    } else {
      chat.scriptstate[mutation.key] = mutation.after
    }
  }
}
