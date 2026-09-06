export type ChatRowsBuildObserver = (chatId: string | undefined) => void

let chatRowsBuildObserver: ChatRowsBuildObserver | null = null

export function recordChatRowsBuild(chatId: string | undefined): void {
  chatRowsBuildObserver?.(chatId)
}

/** Test/performance-harness seam. Production keeps the observer unset. */
export function setChatRowsBuildObserverForTests(observer: ChatRowsBuildObserver | null): void {
  chatRowsBuildObserver = observer
}
