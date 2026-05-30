// Invariant: the request boundary never marks client chat requests as group chat.
declare function requestChatData(payload: unknown): Promise<unknown>

export async function dispatchRequest() {
  return requestChatData({
    useStreaming: true,
    isGroupChat: false,
  })
}
