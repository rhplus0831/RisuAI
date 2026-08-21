import type { character, Chat, Message } from '../../storage/database.svelte'
import { sameStructuredValue } from '../../server/chatMessageRangeMerge'
import type { ServerChatMessageMutation, ServerChatMessagePatch, ServerChatRestoration } from './serverChatEvents'

function cloneMessage(message: Message): Message {
  return structuredClone(message)
}

function cloneMessages(messages: Message[]): Message[] {
  return structuredClone(messages)
}

function sameMessageContent(a: Message | undefined, b: Message): boolean {
  return a?.role === b.role && a.data === b.data && (a.name ?? null) === (b.name ?? null)
}

function sameMessageSuffix(messages: readonly Message[], start: number, incoming: readonly Message[]): boolean {
  if (messages.length - start !== incoming.length) return false
  return incoming.every((message, index) => sameStructuredValue(messages[start + index], message))
}

function applyMessageMutation(chat: Chat, mutation: ServerChatMessageMutation): void {
  if (mutation.type === 'replace_all') {
    if (
      Number.isInteger(mutation.firstChangedIndex) &&
      (mutation.firstChangedIndex as number) >= 0 &&
      (mutation.firstChangedIndex as number) <= chat.message.length
    ) {
      const firstChangedIndex = mutation.firstChangedIndex as number
      if (!sameMessageSuffix(chat.message, firstChangedIndex, mutation.messages)) {
        chat.message.splice(firstChangedIndex, chat.message.length - firstChangedIndex, ...mutation.messages)
      }
    } else {
      if (!sameStructuredValue(chat.message, mutation.messages)) chat.message = mutation.messages
    }
    return
  }

  if (mutation.type === 'replace_by_id') {
    const index = chat.message.findIndex((message) => message.chatId === mutation.messageId)
    if (index >= 0 && !sameStructuredValue(chat.message[index], mutation.message)) {
      chat.message[index] = cloneMessage(mutation.message)
    }
    return
  }

  const next = cloneMessage(mutation.message)
  const existing = chat.message[mutation.index]
  if (sameStructuredValue(existing, next)) return
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

function applyCharacterFieldMutations(character: character, patch: ServerChatMessagePatch): void {
  for (const mutation of patch.characterFieldMutations ?? []) {
    const live = typeof character[mutation.key] === 'string' ? character[mutation.key] : null
    if (live === mutation.before) character[mutation.key] = mutation.after
  }
}

function applyLocalLoreMutation(chat: Chat, patch: ServerChatMessagePatch): void {
  const mutation = patch.localLoreMutation
  if (!mutation) return
  if (sameStructuredValue(chat.localLore ?? [], mutation.before)) {
    chat.localLore = structuredClone(mutation.after) as Chat['localLore']
  }
}

export function applyServerMessagePatch(chat: Chat, patch: ServerChatMessagePatch, character?: character): void {
  chat.message ??= []
  for (const mutation of patch.messageMutations) {
    applyMessageMutation(chat, mutation)
  }

  if (patch.chatVarMutations.length > 0) {
    if (!chat.scriptstate && patch.chatVarMutations.some((mutation) => mutation.after !== null)) {
      chat.scriptstate = {}
    }
    for (const mutation of patch.chatVarMutations) {
      if (mutation.after === null) {
        if (chat.scriptstate && Object.prototype.hasOwnProperty.call(chat.scriptstate, mutation.key)) {
          delete chat.scriptstate[mutation.key]
        }
      } else if (chat.scriptstate?.[mutation.key] !== mutation.after) {
        chat.scriptstate ??= {}
        chat.scriptstate[mutation.key] = mutation.after
      }
    }
  }

  for (const mutation of patch.chatMetadataMutations ?? []) {
    if (mutation.after === null) {
      if (Object.prototype.hasOwnProperty.call(chat, 'lastMemory')) delete chat.lastMemory
    } else if (chat.lastMemory !== mutation.after) chat.lastMemory = mutation.after
  }

  if (character) applyCharacterFieldMutations(character, patch)
  applyLocalLoreMutation(chat, patch)
}

export function applyServerChatRestoration(chat: Chat, restoration: ServerChatRestoration): void {
  chat.message = cloneMessages(restoration.messages)
  if (restoration.scriptstate && Object.keys(restoration.scriptstate).length > 0) {
    chat.scriptstate = structuredClone(restoration.scriptstate)
  } else {
    delete chat.scriptstate
  }
  chat.isStreaming = false
}
