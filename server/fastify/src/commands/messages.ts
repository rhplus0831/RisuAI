import { randomUUID } from 'node:crypto'
import { EntityNotFoundError, ValidationError } from '../repository.js'
import type { ChatRecord } from './chats.js'
import { ensureCharacterChats, normalizeAllCharacterChats, requireChatLocation } from './chats.js'
import type { CharacterRecord } from './characters.js'
import { readJsonObject } from './characters.js'

type JsonRecord = Record<string, unknown>

export interface MessageRecord extends JsonRecord {
  role: 'user' | 'char'
  data: string
  chatId: string
}

export interface MessageLocation {
  character: CharacterRecord
  chat: ChatRecord
  message: MessageRecord
  messageIndex: number
}

export interface GenerationResultRecord extends JsonRecord {
  message: MessageRecord
  targetMessageId?: string
}

const ALLOWED_MESSAGE_PATCH_KEYS = new Set([
  'role',
  'data',
  'saying',
  'time',
  'promptInfo',
  'name',
  'otherUser',
  'disabled',
  'isComment',
])

export function normalizeAllChatMessages(database: unknown): CharacterRecord[] {
  const characters = normalizeAllCharacterChats(database)
  for (const character of characters) {
    for (const chat of ensureCharacterChats(character)) {
      ensureChatMessages(chat)
    }
  }
  return characters
}

export function ensureChatMessages(chat: ChatRecord): MessageRecord[] {
  if (!Array.isArray(chat.message)) {
    chat.message = []
  }

  const seen = new Set<string>()
  const messages = (chat.message as unknown[]).map((raw, index) => {
    const message = createMessageRecord(raw, `message[${index}]`)
    if (seen.has(message.chatId)) {
      message.chatId = randomUUID()
    }
    seen.add(message.chatId)
    return message
  })
  chat.message = messages
  return messages
}

export function createMessageRecord(input: unknown, label = 'message'): MessageRecord {
  const message = readJsonObject(input, label) as MessageRecord
  message.chatId =
    typeof message.chatId === 'string' && message.chatId.trim() ? message.chatId : randomUUID()
  validateMessageRecord(message, label)
  return message
}

export function readMessageId(value: unknown, label = 'messageId'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
  }
  return value
}

export function readMessagePatch(input: unknown): JsonRecord {
  const patch = readJsonObject(input, 'patch')
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('patch must include at least one message field')
  }
  for (const key of Object.keys(patch)) {
    if (!ALLOWED_MESSAGE_PATCH_KEYS.has(key)) {
      throw new ValidationError(`patch.${key} is not supported for message commands`)
    }
  }
  validateMessageRecord(patch, 'patch', { partial: true })
  return patch
}

export function readReplacementMessages(input: unknown): MessageRecord[] {
  if (!Array.isArray(input)) {
    throw new ValidationError('messages must be an array')
  }
  const messages = input.map((message, index) => createMessageRecord(message, `messages[${index}]`))
  validateUniqueMessageIds(messages)
  return messages
}

export function readGenerationResult(input: unknown): GenerationResultRecord {
  const result = readJsonObject(input, 'generationResult')
  const message = createMessageRecord(result.message, 'generationResult.message')
  if (message.role !== 'char') {
    throw new ValidationError('generationResult.message.role must be char')
  }
  validateJsonRecord(message.promptInfo, 'generationResult.message.promptInfo')
  if (message.generationInfo === undefined) {
    throw new ValidationError('generationResult.message.generationInfo is required')
  }
  validateJsonRecord(message.generationInfo, 'generationResult.message.generationInfo')
  const targetMessageId =
    result.targetMessageId === undefined || result.targetMessageId === null
      ? undefined
      : readMessageId(result.targetMessageId, 'generationResult.targetMessageId')
  return { ...result, message, targetMessageId }
}

export function readTruncateAfterMessageId(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return readMessageId(value, 'afterMessageId')
}

export function requireMessageLocation(
  characters: readonly CharacterRecord[],
  messageId: string,
): MessageLocation {
  for (const character of characters) {
    for (const chat of ensureCharacterChats(character)) {
      const messages = ensureChatMessages(chat)
      const messageIndex = messages.findIndex((message) => message.chatId === messageId)
      if (messageIndex !== -1) {
        return {
          character,
          chat,
          message: messages[messageIndex],
          messageIndex,
        }
      }
    }
  }
  throw new EntityNotFoundError(`Message not found: ${messageId}`)
}

export function requireChatMessages(
  characters: readonly CharacterRecord[],
  chatId: string,
): { character: CharacterRecord; chat: ChatRecord; messages: MessageRecord[] } {
  const { character, chat } = requireChatLocation(characters, chatId)
  return { character, chat, messages: ensureChatMessages(chat) }
}

export function validateUniqueMessageIds(messages: readonly MessageRecord[]): void {
  const seen = new Set<string>()
  for (const message of messages) {
    if (seen.has(message.chatId)) {
      throw new ValidationError(`Duplicate message id: ${message.chatId}`)
    }
    seen.add(message.chatId)
  }
}

function validateMessageRecord(
  record: JsonRecord,
  label: string,
  options: { partial?: boolean } = {},
): void {
  if ('chatId' in record && (typeof record.chatId !== 'string' || record.chatId.trim() === '')) {
    throw new ValidationError(`${label}.chatId must be a non-empty string`)
  }
  if (!options.partial || 'role' in record) {
    if (record.role !== 'user' && record.role !== 'char') {
      throw new ValidationError(`${label}.role must be user or char`)
    }
  }
  if (!options.partial || 'data' in record) {
    if (typeof record.data !== 'string') {
      throw new ValidationError(`${label}.data must be a string`)
    }
  }
  if ('saying' in record && record.saying !== undefined && typeof record.saying !== 'string') {
    throw new ValidationError(`${label}.saying must be a string`)
  }
  if (
    'time' in record &&
    record.time !== undefined &&
    record.time !== null &&
    (typeof record.time !== 'number' || !Number.isFinite(record.time))
  ) {
    throw new ValidationError(`${label}.time must be a finite number, null, or undefined`)
  }
  if ('promptInfo' in record) {
    validateJsonRecord(record.promptInfo, `${label}.promptInfo`)
  }
  if ('generationInfo' in record) {
    validateJsonRecord(record.generationInfo, `${label}.generationInfo`)
  }
  if ('name' in record && record.name !== null && typeof record.name !== 'string') {
    throw new ValidationError(`${label}.name must be a string or null`)
  }
  if ('otherUser' in record && typeof record.otherUser !== 'boolean') {
    throw new ValidationError(`${label}.otherUser must be a boolean`)
  }
  if (
    'disabled' in record &&
    record.disabled !== false &&
    record.disabled !== true &&
    record.disabled !== 'allBefore'
  ) {
    throw new ValidationError(`${label}.disabled must be false, true, or allBefore`)
  }
  if ('isComment' in record && typeof record.isComment !== 'boolean') {
    throw new ValidationError(`${label}.isComment must be a boolean`)
  }
}

function validateJsonRecord(value: unknown, label: string): void {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`)
  }
}
