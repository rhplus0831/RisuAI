import { get, writable } from 'svelte/store'

const MAX_SERVER_OWNED_GENERATED_MESSAGE_IDS = 512

/** Newly appended rows that may still use the component's client-owned auto trigger. */
export const automaticTranslationMessageIds = writable<string[]>([])

/**
 * Generated rows whose automatic translation lifecycle is server-owned. This
 * set outlives the current render turn so a fast done frame can arrive before
 * Chats.svelte observes and registers the appended row.
 */
export const serverOwnedGeneratedMessageIds = writable<ReadonlySet<string>>(new Set())

export function replaceAutomaticTranslationMessageIds(messageIds: readonly string[]): void {
  automaticTranslationMessageIds.set([...new Set(messageIds)])
}

export function consumeAutomaticTranslationEligibility(messageId: string): void {
  if (!messageId) return
  automaticTranslationMessageIds.update((messageIds) => messageIds.filter((candidate) => candidate !== messageId))
}

export function consumeServerOwnedGeneratedMessageEligibility(messageId: string): void {
  const normalized = messageId.trim()
  if (!normalized) return
  consumeAutomaticTranslationEligibility(normalized)
  serverOwnedGeneratedMessageIds.update((current) => {
    const next = new Set(current)
    next.delete(normalized)
    next.add(normalized)
    while (next.size > MAX_SERVER_OWNED_GENERATED_MESSAGE_IDS) {
      const oldest = next.values().next().value as string | undefined
      if (!oldest) break
      next.delete(oldest)
    }
    return next
  })
}

export function resetAutomaticTranslationEligibilityForTests(): void {
  automaticTranslationMessageIds.set([])
  serverOwnedGeneratedMessageIds.set(new Set())
}

export function isClientAutomaticTranslationEligible(messageId: string): boolean {
  return get(automaticTranslationMessageIds).includes(messageId) && !get(serverOwnedGeneratedMessageIds).has(messageId)
}
