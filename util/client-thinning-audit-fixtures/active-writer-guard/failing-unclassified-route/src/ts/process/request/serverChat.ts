// EC5 needle carrier for the server chat client helper. In the real tree this
// attaches the writer session header and handles the stale-writer (423)
// response for chat generation.
export const serverChatActiveWriterHandling = {
  header: 'activeWriterSessionHeader',
  stale: 'handleActiveWriterStaleResponse',
}
