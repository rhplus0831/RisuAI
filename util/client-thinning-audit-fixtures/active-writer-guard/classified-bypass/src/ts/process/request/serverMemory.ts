// EC5 needle carrier for the server memory client helper. In the real tree this
// attaches the writer session header, marks the request as a writer mutation,
// and handles the stale-writer (423) response.
export const serverMemoryActiveWriterHandling = {
  header: 'activeWriterSessionHeader',
  stale: 'handleActiveWriterStaleResponse',
  requestOptions: { activeWriter: true },
}
