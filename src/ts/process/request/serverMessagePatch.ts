import type { character, Chat, Message } from '../../storage/database.svelte'
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

function sameStructuredValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((value, index) => sameStructuredValue(value, b[index]))
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>
  const aKeys = Object.keys(aRecord)
  const bKeys = Object.keys(bRecord)
  if (aKeys.length !== bKeys.length || aKeys.some((key) => !Object.prototype.hasOwnProperty.call(bRecord, key))) {
    return false
  }
  return aKeys.every((key) => sameStructuredValue(aRecord[key], bRecord[key]))
}

function applyMessageMutation(chat: Chat, mutation: ServerChatMessageMutation): void {
  if (mutation.type === 'replace_all') {
    if (
      Number.isInteger(mutation.firstChangedIndex) &&
      (mutation.firstChangedIndex as number) >= 0 &&
      (mutation.firstChangedIndex as number) <= chat.message.length
    ) {
      chat.message.splice(mutation.firstChangedIndex as number, chat.message.length, ...mutation.messages)
    } else {
      chat.message = mutation.messages
    }
    return
  }

  if (mutation.type === 'replace_by_id') {
    const index = chat.message.findIndex((message) => message.chatId === mutation.messageId)
    if (index >= 0) chat.message[index] = cloneMessage(mutation.message)
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
    chat.scriptstate ??= {}
    for (const mutation of patch.chatVarMutations) {
      if (mutation.after === null) {
        delete chat.scriptstate[mutation.key]
      } else {
        chat.scriptstate[mutation.key] = mutation.after
      }
    }
  }

  for (const mutation of patch.chatMetadataMutations ?? []) {
    if (mutation.after === null) delete chat.lastMemory
    else chat.lastMemory = mutation.after
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
