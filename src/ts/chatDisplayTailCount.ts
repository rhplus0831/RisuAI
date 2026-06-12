export const DEFAULT_CHAT_DISPLAY_TAIL_COUNT = 30
export const MIN_CHAT_DISPLAY_TAIL_COUNT = 1
export const MAX_CHAT_DISPLAY_TAIL_COUNT = 500

export function normalizeChatDisplayTailCount(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : DEFAULT_CHAT_DISPLAY_TAIL_COUNT

  if (!Number.isFinite(parsed)) return DEFAULT_CHAT_DISPLAY_TAIL_COUNT
  return Math.min(MAX_CHAT_DISPLAY_TAIL_COUNT, Math.max(MIN_CHAT_DISPLAY_TAIL_COUNT, Math.round(parsed)))
}
