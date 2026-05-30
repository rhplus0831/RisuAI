// Violation: the request boundary no longer pins isGroupChat to false.
declare function requestChatData(payload: unknown): Promise<unknown>

export async function dispatchRequest() {
  return requestChatData({
    useStreaming: true,
  })
}
