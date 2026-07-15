const REALM_IMPORT_ID_MAX_LENGTH = 256
const REALM_IMPORT_QUERY_KEYS = ['realm', 'code'] as const

function normalizeRealmImportId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  if (id.length === 0 || id.length > REALM_IMPORT_ID_MAX_LENGTH || /[\s/?#\u0000-\u001f\u007f]/u.test(id)) {
    return null
  }
  return id
}

function idFromQuery(searchParams: URLSearchParams): string | null {
  for (const key of REALM_IMPORT_QUERY_KEYS) {
    const id = normalizeRealmImportId(searchParams.get(key))
    if (id) return id
  }
  return null
}

function idFromUrl(input: string): string | null {
  try {
    const url = new URL(input, 'https://realm.risuai.net')
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

    const queryId = idFromQuery(url.searchParams)
    if (queryId) return queryId

    const segments = url.pathname.split('/').filter(Boolean)
    const encodedId = segments.at(-1)
    if (!encodedId || encodedId.toLowerCase() === 'character') return null
    return normalizeRealmImportId(decodeURIComponent(encodedId))
  } catch {
    return null
  }
}

/** Resolve a Realm character share URL, query fragment, or plain character id. */
export function resolveRealmImportId(input: string): string | null {
  const value = input.trim()
  if (value.length === 0) return null

  if (/^[a-z][a-z\d+.-]*:/iu.test(value) || value.startsWith('//')) {
    return idFromUrl(value)
  }

  if (value.startsWith('?') || value.startsWith('realm=') || value.startsWith('code=')) {
    try {
      return idFromQuery(new URLSearchParams(value.startsWith('?') ? value.slice(1) : value))
    } catch {
      return null
    }
  }

  return normalizeRealmImportId(value)
}
