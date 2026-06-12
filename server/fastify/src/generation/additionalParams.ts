/**
 * Server-side port of the SPA's `additionalParams` DSL. The local code lives
 * in `src/ts/process/request/shared.ts` (applyAdditionalParameters,
 * setObjectValue) and `src/ts/process/request/additionalParams.ts`
 * (parseAdditionalParamJsonValue). Semantics are preserved verbatim so that
 * server-routed xcustom and reverse_proxy paths behave identically to the
 * local browser path.
 *
 * Each entry is a `[key, value]` pair drawn from the per-model `params`
 * string (or `db.additionalParams` for reverse_proxy). Both come from
 * user-authored text on the SPA, so the value side carries a small typing
 * DSL:
 *   - `{{none}}` removes the field (or header)
 *   - `header::Name` keys target the headers map instead of the body
 *   - `json::<value>` JSON-parses the right-hand side (with a relaxed
 *     `True`/`False`/`None` → JSON keywords pass)
 *   - Quoted strings (single or double) stay as strings
 *   - `true`/`false`/`null` map to typed JS values
 *   - Otherwise: numeric if `Number(value)` succeeds, else string
 *
 * Keys with dots traverse into nested body objects, e.g. `extra.params.k=1`.
 */

const RELAXED_JSON_KEYWORDS = [
  ['True', 'true'],
  ['False', 'false'],
  ['None', 'null'],
] as const

function isRelaxedJsonBoundary(char: string | undefined): boolean {
  return !char || !/[A-Za-z0-9_$]/.test(char)
}

function normalizeRelaxedJsonKeywords(value: string): string {
  let normalized = ''
  let quote: '"' | "'" | null = null

  for (let i = 0; i < value.length; i++) {
    const char = value[i]

    if (quote) {
      normalized += char

      if (char === '\\' && i + 1 < value.length) {
        normalized += value[++i]
        continue
      }

      if (char === quote) {
        quote = null
      }

      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      normalized += char
      continue
    }

    let replaced = false

    for (const [keyword, replacement] of RELAXED_JSON_KEYWORDS) {
      if (
        value.startsWith(keyword, i) &&
        isRelaxedJsonBoundary(value[i - 1]) &&
        isRelaxedJsonBoundary(value[i + keyword.length])
      ) {
        normalized += replacement
        i += keyword.length - 1
        replaced = true
        break
      }
    }

    if (!replaced) {
      normalized += char
    }
  }

  return normalized
}

export function parseAdditionalParamJsonValue(value: string): unknown | undefined {
  try {
    return JSON.parse(value)
  } catch {
    // fall through to relaxed pass
  }

  const normalized = normalizeRelaxedJsonKeywords(value)
  if (normalized === value) {
    return undefined
  }

  try {
    return JSON.parse(normalized)
  } catch {
    return undefined
  }
}

/**
 * Key segments that would walk into (or overwrite) the prototype chain instead
 * of plain data. `a.__proto__.x` traverses to `Object.prototype` and then
 * writes onto it — a server-global pollution, unlike the browser where the DSL
 * only affects one tab (audit L24). Entries carrying one are dropped whole.
 */
const FORBIDDEN_KEY_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

function setObjectValue(obj: Record<string, unknown>, key: string, value: unknown): void {
  const splitKey = key.split('.')
  if (splitKey.some((segment) => FORBIDDEN_KEY_SEGMENTS.has(segment))) return
  let cursor: Record<string, unknown> = obj
  for (let i = 0; i < splitKey.length - 1; i++) {
    const segment = splitKey[i]
    const next = cursor[segment]
    if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next)) {
      const fresh: Record<string, unknown> = {}
      cursor[segment] = fresh
      cursor = fresh
    } else {
      cursor = next as Record<string, unknown>
    }
  }
  cursor[splitKey[splitKey.length - 1]] = value
}

/**
 * Mutates `body` and `headers` in place according to the DSL. Returns
 * `body` so call sites can chain it ergonomically.
 */
export function applyAdditionalParameters(
  body: Record<string, unknown>,
  headers: Record<string, string>,
  additionalParams: Array<[string, string]>,
): Record<string, unknown> {
  for (const [rawKey, rawValue] of additionalParams) {
    const key = rawKey
    const value = rawValue

    if (!key || !value) continue

    if (value === '{{none}}') {
      if (key.startsWith('header::')) {
        delete headers[key.slice('header::'.length)]
      } else {
        // Local semantics: `{{none}}` on a body key deletes the literal
        // top-level key only (no dotted traversal). Mirror that.
        delete body[key]
      }
      continue
    }

    if (key.startsWith('header::')) {
      headers[key.slice('header::'.length)] = value
      continue
    }

    if (value.startsWith('json::')) {
      const parsedValue = parseAdditionalParamJsonValue(value.slice('json::'.length))
      if (parsedValue !== undefined) {
        setObjectValue(body, key, parsedValue)
      }
      continue
    }

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      setObjectValue(body, key, value.slice(1, -1))
      continue
    }

    if (value === 'true' || value === 'false') {
      setObjectValue(body, key, value === 'true')
      continue
    }

    if (value === 'null') {
      setObjectValue(body, key, null)
      continue
    }

    const num = Number(value)
    setObjectValue(body, key, Number.isNaN(num) ? value : num)
  }

  return body
}

/**
 * Validates a payload-side `additionalParams` field. The route hands us
 * `unknown`; we want a strict `Array<[string, string]>` to apply, or null
 * for "absent / malformed" (the caller decides whether to 400 or proceed).
 */
export function coerceAdditionalParams(raw: unknown): Array<[string, string]> | null {
  if (raw === undefined || raw === null) return null
  if (!Array.isArray(raw)) return null
  const out: Array<[string, string]> = []
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) return null
    const [k, v] = entry
    if (typeof k !== 'string' || typeof v !== 'string') return null
    out.push([k, v])
  }
  return out
}
