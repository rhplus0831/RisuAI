export function isImportableMCPIdentifier(value: string): boolean {
  if (/^(internal|stdio|plugin):\S+$/.test(value)) return true
  if (!value.startsWith('https://') && !value.startsWith('http://')) return false
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    if (url.protocol !== 'http:') return false
    return url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname)
  } catch {
    return false
  }
}
