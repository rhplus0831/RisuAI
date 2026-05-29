// A4R-group-chat-removed fixture (passing): the request boundary keeps isGroupChat
// hardcoded false.
declare function requestChatData(payload: unknown): Promise<unknown>

export async function dispatchRequest() {
  return requestChatData({
    useStreaming: true,
    isGroupChat: false,
  })
}
