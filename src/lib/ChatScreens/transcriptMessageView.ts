export const TRANSCRIPT_MESSAGE_VIEW_CONTEXT = Symbol('transcript-message-view')
export const MAX_TRANSCRIPT_MESSAGE_VIEWS = 2048
export const MAX_TRANSCRIPT_MESSAGE_VIEW_KEY_LENGTH = 2048

export interface TranscriptMessageView {
  translated: boolean
  suppressAutomaticTranslationDisplay: boolean
}

export interface TranscriptMessageViewOwner {
  capture(messageId: string | null | undefined): {
    read(): TranscriptMessageView | undefined
    write(view: TranscriptMessageView): void
  }
  reset(): void
}

/** Keeps small display preferences across row eviction, never message bodies or drafts. */
export function createTranscriptMessageViewOwner(): TranscriptMessageViewOwner {
  const entries = new Map<string, TranscriptMessageView>()
  let epoch = 0

  return {
    capture(messageId) {
      const capturedEpoch = epoch
      const key = messageId && messageId.length <= MAX_TRANSCRIPT_MESSAGE_VIEW_KEY_LENGTH ? messageId : undefined
      return {
        read() {
          if (!key || capturedEpoch !== epoch) return undefined
          const view = entries.get(key)
          if (!view) return undefined
          entries.delete(key)
          entries.set(key, view)
          return { ...view }
        },
        write(view) {
          if (!key || capturedEpoch !== epoch) return
          entries.delete(key)
          entries.set(key, {
            translated: view.translated,
            suppressAutomaticTranslationDisplay: view.suppressAutomaticTranslationDisplay,
          })
          while (entries.size > MAX_TRANSCRIPT_MESSAGE_VIEWS) {
            entries.delete(entries.keys().next().value!)
          }
        },
      }
    },
    reset() {
      epoch += 1
      entries.clear()
    },
  }
}
