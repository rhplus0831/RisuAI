export function parseDevToolAutopilotImport(name: string, data: Uint8Array): string[] | null {
  const text = new TextDecoder().decode(data)
  const lowerName = name.toLowerCase()

  if (lowerName.endsWith('.json')) {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : null
  }
  if (lowerName.endsWith('.csv')) {
    return text
      .split('\n')
      .map((item) => item.replace(/\r/g, '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r'))
  }
  if (lowerName.endsWith('.txt')) return text.split('\n')
  return null
}
