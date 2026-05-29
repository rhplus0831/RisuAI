// A4R-group-chat-removed fixture (bypass): the isGroupChat: false hardcode was
// dropped from the request boundary.
declare function requestChatData(payload: unknown): Promise<unknown>

export async function dispatchRequest() {
  return requestChatData({
    useStreaming: true,
  })
}
