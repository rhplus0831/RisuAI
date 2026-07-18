export type RetainedChatProjectionTarget =
  | { kind: 'character'; characterId?: string }
  | { kind: 'chat-body'; chatId?: string }

interface RetainedChatProjectionRecord {
  sequence: number
  target: RetainedChatProjectionTarget
  reapply: () => void
  onInvalidated?: () => void
}

const retainedChatProjections = new Set<RetainedChatProjectionRecord>()
let nextRetainedChatProjectionSequence = 0

/** Keep an optimistic chat projection available to authoritative read paths. */
export function registerRetainedChatProjection(
  target: RetainedChatProjectionTarget,
  reapply: () => void,
  onInvalidated?: () => void,
): () => void {
  const record: RetainedChatProjectionRecord = {
    sequence: ++nextRetainedChatProjectionSequence,
    target,
    reapply,
    onInvalidated,
  }
  retainedChatProjections.add(record)
  return () => retainedChatProjections.delete(record)
}

export function reapplyRetainedCharacterProjections(characterId?: string): void {
  reapplyMatchingRetainedChatProjections(
    (target) =>
      target.kind === 'character' && (!target.characterId || !characterId || target.characterId === characterId),
  )
}

export function reapplyRetainedChatBodyProjections(chatId?: string): void {
  reapplyMatchingRetainedChatProjections(
    (target) => target.kind === 'chat-body' && (!target.chatId || !chatId || target.chatId === chatId),
  )
}

function reapplyMatchingRetainedChatProjections(matches: (target: RetainedChatProjectionTarget) => boolean): void {
  const records = Array.from(retainedChatProjections)
    .filter((record) => matches(record.target))
    .sort((left, right) => left.sequence - right.sequence)
  for (const record of records) {
    if (!retainedChatProjections.has(record)) continue
    try {
      record.reapply()
    } catch (error) {
      console.error('Unable to reapply retained chat projection:', error)
    }
  }
}

export function clearRetainedChatProjections(): void {
  const records = Array.from(retainedChatProjections).sort((left, right) => left.sequence - right.sequence)
  retainedChatProjections.clear()
  nextRetainedChatProjectionSequence = 0
  for (const record of records) {
    try {
      record.onInvalidated?.()
    } catch (error) {
      console.error('Unable to invalidate retained chat projection:', error)
    }
  }
}

export const resetRetainedChatProjectionsForTests = clearRetainedChatProjections
