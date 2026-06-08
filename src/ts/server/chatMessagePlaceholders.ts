export const SERVER_UNLOADED_CHAT_MESSAGE_MARKER = '__risuServerUnloadedMessage'

export function isServerChatMessagePlaceholder(message: unknown): boolean {
  return (
    !!message &&
    typeof message === 'object' &&
    (message as Record<string, unknown>)[SERVER_UNLOADED_CHAT_MESSAGE_MARKER] === true
  )
}
