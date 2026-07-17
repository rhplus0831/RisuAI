import rfdc from 'rfdc'

const rfdcClone = rfdc({
  circles: false,
})

/** Clone with the platform structured clone algorithm, falling back for unsupported values such as functions. */
export function safeStructuredClone<T>(data: T): T {
  try {
    return structuredClone(data)
  } catch {
    return rfdcClone(data)
  }
}
