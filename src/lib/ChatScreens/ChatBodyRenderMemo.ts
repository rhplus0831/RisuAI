const MAX_ENTRIES = 2
const MAX_BYTES = 1024 * 1024

/** Keep the pending and settled bodies across reactive updates of one row. */
export function createChatBodyRenderMemo(render: (html: string, model: string) => string) {
  const entries: { html: string; model: string; policy: string; output: string; bytes: number }[] = []
  let bytes = 0
  return (html: string, model: string, policy: string): string => {
    const index = entries.findIndex((entry) => entry.html === html && entry.model === model && entry.policy === policy)
    if (index >= 0) {
      const [entry] = entries.splice(index, 1)
      entries.push(entry)
      return entry.output
    }
    const output = render(html, model)
    const size = 2 * (html.length + output.length + model.length + policy.length)
    if (size > MAX_BYTES) return output
    while (entries.length >= MAX_ENTRIES || bytes + size > MAX_BYTES) bytes -= entries.shift()!.bytes
    entries.push({ html, model, policy, output, bytes: size })
    bytes += size
    return output
  }
}
