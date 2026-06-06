export const PREREROLL_BUFFER_LIMIT = 48

interface PrererollEntry {
  values: string[]
  index: number
}

let rerolls = new Map<string, PrererollEntry>()

function touchEntry(genId: string): PrererollEntry | undefined {
  const entry = rerolls.get(genId)
  if (!entry) return undefined
  rerolls.delete(genId)
  rerolls.set(genId, entry)
  return entry
}

function evictOverflow(): void {
  while (rerolls.size > PREREROLL_BUFFER_LIMIT) {
    const oldest = rerolls.keys().next().value
    if (oldest === undefined) return
    rerolls.delete(oldest)
  }
}

export function Prereroll(genId: string) {
  const entry = touchEntry(genId)
  if (!entry) return null
  entry.index += 1
  return entry.values[entry.index] ?? null
}
export function PreUnreroll(genId: string) {
  const entry = touchEntry(genId)
  if (!entry) return null
  const index = entry.index - 1
  if (index < 0) {
    return null
  }
  entry.index = index
  return entry.values[entry.index] ?? null
}

export function addRerolls(genId: string, values: string[]) {
  rerolls.delete(genId)
  rerolls.set(genId, { values: values.slice(), index: 0 })
  evictOverflow()
}

export function clearPrererolls(): void {
  rerolls.clear()
}

export function getPrererollBufferSize(): number {
  return rerolls.size
}
