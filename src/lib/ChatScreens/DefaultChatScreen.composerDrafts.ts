export interface DefaultChatComposerDraft {
  messageInput: string
  messageInputTranslate: string
  fileInput: string[]
}

export const DEFAULT_CHAT_COMPOSER_DRAFT_LIMIT = 50

const composerDrafts = new Map<string, DefaultChatComposerDraft>()

export function readDefaultChatComposerDraft(identity: string): DefaultChatComposerDraft | undefined {
  const draft = composerDrafts.get(identity)
  if (!draft) return undefined

  // Refresh the insertion order so the bounded cache evicts the least recently
  // used transcript rather than a draft the user just reopened.
  composerDrafts.delete(identity)
  composerDrafts.set(identity, draft)
  return cloneComposerDraft(draft)
}

export function writeDefaultChatComposerDraft(identity: string, draft: DefaultChatComposerDraft): void {
  composerDrafts.delete(identity)
  composerDrafts.set(identity, cloneComposerDraft(draft))

  while (composerDrafts.size > DEFAULT_CHAT_COMPOSER_DRAFT_LIMIT) {
    const oldestIdentity = composerDrafts.keys().next().value
    if (oldestIdentity === undefined) break
    composerDrafts.delete(oldestIdentity)
  }
}

export function deleteDefaultChatComposerDraft(identity: string): void {
  composerDrafts.delete(identity)
}

export function clearDefaultChatComposerDrafts(): void {
  composerDrafts.clear()
}

function cloneComposerDraft(draft: DefaultChatComposerDraft): DefaultChatComposerDraft {
  return {
    messageInput: draft.messageInput,
    messageInputTranslate: draft.messageInputTranslate,
    fileInput: [...draft.fileInput],
  }
}
