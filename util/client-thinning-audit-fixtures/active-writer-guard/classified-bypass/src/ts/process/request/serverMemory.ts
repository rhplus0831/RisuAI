// Server memory client needle carrier for writer headers, writer mutation flags,
// and stale-writer handling.
export const serverMemoryActiveWriterHandling = {
  header: 'activeWriterSessionHeader',
  stale: 'handleActiveWriterStaleResponse',
  requestOptions: { activeWriter: true },
}
