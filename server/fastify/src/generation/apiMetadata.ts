export function extractApiResponseMetadata(
  value: unknown,
  omittedKeys: readonly string[],
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const omitted = new Set(omittedKeys)
  const entries = Object.entries(value).filter(([key, item]) => !omitted.has(key) && item !== undefined)
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

export function mergeApiResponseMetadata(
  ...values: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  const entries = values.flatMap((value) => (value ? Object.entries(value) : []))
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}
