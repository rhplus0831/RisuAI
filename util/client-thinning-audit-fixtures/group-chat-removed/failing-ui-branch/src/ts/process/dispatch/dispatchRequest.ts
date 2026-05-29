// A4R-group-chat-removed fixture (failing-ui-branch): keep-layers intact so only the
// negative half (UI branch) fails.
declare function requestChatData(payload: unknown): Promise<unknown>

export async function dispatchRequest() {
  return requestChatData({
    useStreaming: true,
    isGroupChat: false,
  })
}
