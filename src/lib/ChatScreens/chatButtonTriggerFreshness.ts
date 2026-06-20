export interface ChatButtonTriggerOperationTracker {
  latestToken: number
}

export interface ChatButtonTriggerIdentity {
  triggerName?: string | null
  triggerId?: string | null
  btnEvent?: string | null
}

export interface ChatButtonTriggerTarget extends ChatButtonTriggerIdentity {
  selectedCharacterIndex: number
  characterId?: string | null
  chatPage: number
  chatId?: string | null
  messageIndex: number
  messageId?: string | null
  messageData?: string | null
  messageRole?: string | null
  transcriptLength: number
  tailMessageId?: string | null
  tailMessageData?: string | null
  tailMessageRole?: string | null
  chatStateSignature?: string | null
}

export interface ChatButtonTriggerFreshnessSnapshot extends ChatButtonTriggerTarget {
  operationToken: number
}

export type ChatButtonTriggerFreshnessRejectReason =
  | 'superseded-operation'
  | 'character-changed'
  | 'chat-changed'
  | 'message-changed'
  | 'source-changed'
  | 'transcript-changed'
  | 'trigger-changed'

export type ChatButtonTriggerFreshnessResult =
  | { ok: true }
  | { ok: false; reason: ChatButtonTriggerFreshnessRejectReason }

export function createChatButtonTriggerOperationTracker(): ChatButtonTriggerOperationTracker {
  return { latestToken: 0 }
}

export const renderedChatButtonTriggerOperationTracker = createChatButtonTriggerOperationTracker()

export function captureChatButtonTriggerFreshness(
  target: ChatButtonTriggerTarget,
  tracker: ChatButtonTriggerOperationTracker,
): ChatButtonTriggerFreshnessSnapshot {
  tracker.latestToken += 1
  return {
    ...normalizeTarget(target),
    operationToken: tracker.latestToken,
  }
}

export function resolveChatButtonTriggerFreshness(
  snapshot: ChatButtonTriggerFreshnessSnapshot,
  liveTarget: ChatButtonTriggerTarget,
  tracker: ChatButtonTriggerOperationTracker,
): ChatButtonTriggerFreshnessResult {
  if (snapshot.operationToken !== tracker.latestToken) {
    return { ok: false, reason: 'superseded-operation' }
  }

  const live = normalizeTarget(liveTarget)

  if (
    snapshot.selectedCharacterIndex !== live.selectedCharacterIndex ||
    !sameStableValue(snapshot.characterId, live.characterId)
  ) {
    return { ok: false, reason: 'character-changed' }
  }

  if (snapshot.chatPage !== live.chatPage || !sameStableValue(snapshot.chatId, live.chatId)) {
    return { ok: false, reason: 'chat-changed' }
  }

  if (snapshot.messageIndex !== live.messageIndex || !sameStableValue(snapshot.messageId, live.messageId)) {
    return { ok: false, reason: 'message-changed' }
  }

  if (snapshot.messageData !== live.messageData || snapshot.messageRole !== live.messageRole) {
    return { ok: false, reason: 'source-changed' }
  }

  if (
    snapshot.transcriptLength !== live.transcriptLength ||
    !sameStableValue(snapshot.tailMessageId, live.tailMessageId) ||
    snapshot.tailMessageData !== live.tailMessageData ||
    snapshot.tailMessageRole !== live.tailMessageRole ||
    !sameStableValue(snapshot.chatStateSignature, live.chatStateSignature)
  ) {
    return { ok: false, reason: 'transcript-changed' }
  }

  if (
    snapshot.triggerName !== live.triggerName ||
    snapshot.triggerId !== live.triggerId ||
    snapshot.btnEvent !== live.btnEvent
  ) {
    return { ok: false, reason: 'trigger-changed' }
  }

  return { ok: true }
}

export function chatButtonTriggerChatSignature(chat: unknown): string {
  return JSON.stringify(chat ?? null)
}

function normalizeTarget<T extends ChatButtonTriggerTarget>(target: T): T {
  return {
    ...target,
    characterId: normalizeNullableString(target.characterId),
    chatId: normalizeNullableString(target.chatId),
    messageId: normalizeNullableString(target.messageId),
    messageData: normalizeNullableString(target.messageData),
    messageRole: normalizeNullableString(target.messageRole),
    tailMessageId: normalizeNullableString(target.tailMessageId),
    tailMessageData: normalizeNullableString(target.tailMessageData),
    tailMessageRole: normalizeNullableString(target.tailMessageRole),
    chatStateSignature: normalizeNullableString(target.chatStateSignature),
    triggerName: normalizeNullableString(target.triggerName),
    triggerId: normalizeNullableString(target.triggerId),
    btnEvent: normalizeNullableString(target.btnEvent),
  }
}

function normalizeNullableString(value: string | null | undefined): string | null {
  return value ?? null
}

function sameStableValue(a: string | null | undefined, b: string | null | undefined): boolean {
  const normalizedA = normalizeNullableString(a)
  const normalizedB = normalizeNullableString(b)
  return normalizedA === null && normalizedB === null ? true : normalizedA === normalizedB
}
