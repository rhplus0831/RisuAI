type JsonSchema = Record<string, unknown>

interface SchemaProperty {
  type: 'array' | 'string' | 'number' | 'boolean'
  items?: SchemaProperty
  enum?: string[]
  const?: string
}

function schemaError(message: string): Error {
  return new Error(`Invalid JSON schema: ${message}`)
}

function parseStringLiteral(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"')) return JSON.parse(trimmed) as string
  if (!trimmed.startsWith("'") || !trimmed.endsWith("'")) {
    throw schemaError(`unsupported type ${value}`)
  }
  return trimmed.slice(1, -1).replace(/\\'/gu, "'").replace(/\\\\/gu, '\\')
}

function parseInterfacePropertyType(value: string): SchemaProperty {
  const type = value.trim()
  if (type === 'string' || type === 'number' || type === 'boolean') return { type }

  const array = /^(?:Array<\s*(string|number|boolean)\s*>|(string|number|boolean)\[\])$/u.exec(type)
  if (array) {
    return { type: 'array', items: { type: (array[1] ?? array[2]) as 'string' | 'number' | 'boolean' } }
  }

  const literals = type.split('|').map(parseStringLiteral)
  if (literals.length === 1) return { type: 'string', const: literals[0] }
  return { type: 'string', enum: literals }
}

function stripLineComment(line: string): string {
  let quote = ''
  let escaped = false
  for (let index = 0; index < line.length - 1; index++) {
    const char = line[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '/' && line[index + 1] === '/') return line.slice(0, index)
  }
  return line
}

/** Parse the JSON or TypeScript-interface syntax exposed by the schema editor. */
export function parseConfiguredJsonSchemaText(raw: string): JsonSchema {
  const text = raw.trim()
  if (!/^(?:export\s+)?interface\s/u.test(text)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw schemaError(error instanceof Error ? error.message : String(error))
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw schemaError('root must be an object')
    }
    return parsed as JsonSchema
  }

  const declaration = /^(?:export\s+)?interface\s+[A-Za-z_$][\w$]*\s*\{([\s\S]*)\}\s*$/u.exec(text)
  if (!declaration) throw schemaError('invalid TypeScript interface declaration')

  const properties: Record<string, SchemaProperty> = {}
  const required: string[] = []
  for (const rawLine of declaration[1].split('\n')) {
    const line = stripLineComment(rawLine).trim()
    if (!line) continue
    const match = /^([A-Za-z_$][\w$]*)(\?)?\s*:\s*(.+?)[;,]?$/u.exec(line)
    if (!match) throw schemaError(`unsupported interface member: ${line}`)
    const [, name, optional, type] = match
    properties[name] = parseInterfacePropertyType(type)
    if (!optional) required.push(name)
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  }
}

function trimJsonOutput(text: string): string {
  let value = text.replace(/<Thoughts>[\s\S]+?<\/Thoughts>/gu, '').trim()
  if (value.startsWith('```json') && value.endsWith('```')) value = value.slice(7, -3).trim()
  return value
}

/** Apply the retained dot-path JSON extraction setting to one completion. */
export function extractConfiguredJsonValue(text: string, path: string): string {
  try {
    const source = trimJsonOutput(text)
    if (!source.startsWith('{') && !source.startsWith('[')) return text
    let current: unknown = JSON.parse(source)
    for (const part of path.split('.')) {
      if (!part || current === null || current === undefined || typeof current !== 'object') return ''
      current = (current as Record<string, unknown>)[part]
    }
    if (current === undefined || current === null) return ''
    return typeof current === 'object' ? JSON.stringify(current) : String(current)
  } catch {
    return text
  }
}
