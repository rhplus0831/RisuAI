import { Type, type Static } from '@sinclair/typebox'

export const SERVER_TOOL_MAX_DEFINITIONS = 64
export const SERVER_TOOL_MAX_CALLS_PER_ROUND = 8
export const SERVER_TOOL_MAX_ROUNDS = 4
export const SERVER_TOOL_MAX_SCHEMA_BYTES = 64 * 1024
export const SERVER_TOOL_MAX_ARGUMENT_BYTES = 64 * 1024
export const SERVER_TOOL_MAX_RESULT_BYTES = 64 * 1024
export const SERVER_TOOL_MAX_PAYLOAD_BYTES = 512 * 1024

const SERVER_TOOL_MAX_NAME_LENGTH = 128
const SERVER_TOOL_MAX_DESCRIPTION_LENGTH = 8 * 1024
const SERVER_TOOL_MAX_CALL_ID_LENGTH = 256
const SERVER_TOOL_NAME_PATTERN = /^[A-Za-z0-9_.:-]+$/u

export const ServerToolJsonRecordSchema = Type.Record(Type.String(), Type.Unknown())

export const ServerToolDefinitionSchema = Type.Object(
  {
    name: Type.String(),
    description: Type.String(),
    inputSchema: ServerToolJsonRecordSchema,
  },
  { additionalProperties: false },
)

export const ServerToolCallSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    arguments: ServerToolJsonRecordSchema,
    /** Provider-authenticated opaque signature required when continuing some Gemini tool calls. */
    thoughtSignature: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
)

export const ServerToolResultSchema = Type.Object(
  {
    callId: Type.String(),
    name: Type.String(),
    content: Type.String(),
  },
  { additionalProperties: false },
)

export const ServerToolRoundSchema = Type.Object(
  {
    assistantContent: Type.String(),
    calls: Type.Array(ServerToolCallSchema),
    results: Type.Array(ServerToolResultSchema),
  },
  { additionalProperties: false },
)

export type ServerToolDefinition = Static<typeof ServerToolDefinitionSchema>
export type ServerToolCall = Static<typeof ServerToolCallSchema>
export type ServerToolResult = Static<typeof ServerToolResultSchema>
export type ServerToolRound = Static<typeof ServerToolRoundSchema>
export type ServerToolValidation<T> = { ok: true; value: T } | { ok: false; error: string }

function invalid<T>(error: string): ServerToolValidation<T> {
  return { ok: false, error }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function boundedJsonRecord(value: unknown, maxBytes: number): Record<string, unknown> | null {
  if (!plainRecord(value)) return null
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined || utf8Bytes(serialized) > maxBytes) return null
    const cloned = JSON.parse(serialized) as unknown
    return plainRecord(cloned) ? cloned : null
  } catch {
    return null
  }
}

function validName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= SERVER_TOOL_MAX_NAME_LENGTH &&
    SERVER_TOOL_NAME_PATTERN.test(value)
  )
}

function validateTotalSize(value: unknown, label: string): ServerToolValidation<true> {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined || utf8Bytes(serialized) > SERVER_TOOL_MAX_PAYLOAD_BYTES) {
      return invalid(`${label} exceeds the ${SERVER_TOOL_MAX_PAYLOAD_BYTES}-byte limit`)
    }
  } catch {
    return invalid(`${label} must be JSON serializable`)
  }
  return { ok: true, value: true }
}

export function validateServerToolDefinitions(value: unknown): ServerToolValidation<ServerToolDefinition[]> {
  if (!Array.isArray(value)) return invalid('tools must be an array')
  if (value.length > SERVER_TOOL_MAX_DEFINITIONS) {
    return invalid(`tools must contain at most ${SERVER_TOOL_MAX_DEFINITIONS} definitions`)
  }
  const totalSize = validateTotalSize(value, 'tools')
  if (totalSize.ok === false) return invalid(totalSize.error)

  const seen = new Set<string>()
  const tools: ServerToolDefinition[] = []
  for (const raw of value) {
    if (!plainRecord(raw)) return invalid('each tool must be an object')
    if (!validName(raw.name)) return invalid('each tool name must be a bounded provider-safe string')
    if (seen.has(raw.name)) return invalid(`duplicate tool name: ${raw.name}`)
    if (typeof raw.description !== 'string' || raw.description.length > SERVER_TOOL_MAX_DESCRIPTION_LENGTH) {
      return invalid(`tool ${raw.name} must have a bounded description`)
    }
    const inputSchema = boundedJsonRecord(raw.inputSchema, SERVER_TOOL_MAX_SCHEMA_BYTES)
    if (!inputSchema) return invalid(`tool ${raw.name} must have a bounded object inputSchema`)
    seen.add(raw.name)
    tools.push({ name: raw.name, description: raw.description, inputSchema })
  }
  return { ok: true, value: tools }
}

export function validateServerToolCalls(
  value: unknown,
  allowedToolNames: ReadonlySet<string>,
): ServerToolValidation<ServerToolCall[]> {
  if (!Array.isArray(value)) return invalid('toolCalls must be an array')
  if (value.length === 0 || value.length > SERVER_TOOL_MAX_CALLS_PER_ROUND) {
    return invalid(`toolCalls must contain between 1 and ${SERVER_TOOL_MAX_CALLS_PER_ROUND} calls`)
  }
  const totalSize = validateTotalSize(value, 'toolCalls')
  if (totalSize.ok === false) return invalid(totalSize.error)

  const seenIds = new Set<string>()
  const calls: ServerToolCall[] = []
  for (const raw of value) {
    if (!plainRecord(raw)) return invalid('each tool call must be an object')
    if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > SERVER_TOOL_MAX_CALL_ID_LENGTH) {
      return invalid('each tool call id must be a bounded non-empty string')
    }
    if (seenIds.has(raw.id)) return invalid(`duplicate tool call id: ${raw.id}`)
    if (!validName(raw.name) || !allowedToolNames.has(raw.name)) {
      return invalid(`tool call requested an unavailable tool: ${String(raw.name)}`)
    }
    const args = boundedJsonRecord(raw.arguments, SERVER_TOOL_MAX_ARGUMENT_BYTES)
    if (!args) return invalid(`tool call ${raw.id} must have bounded object arguments`)
    if (
      raw.thoughtSignature !== undefined &&
      (typeof raw.thoughtSignature !== 'string' || utf8Bytes(raw.thoughtSignature) > SERVER_TOOL_MAX_ARGUMENT_BYTES)
    ) {
      return invalid(`tool call ${raw.id} must have a bounded thoughtSignature when provided`)
    }
    seenIds.add(raw.id)
    calls.push({
      id: raw.id,
      name: raw.name,
      arguments: args,
      ...(typeof raw.thoughtSignature === 'string' ? { thoughtSignature: raw.thoughtSignature } : {}),
    })
  }
  return { ok: true, value: calls }
}

export function validateServerToolRounds(
  value: unknown,
  allowedToolNames: ReadonlySet<string>,
): ServerToolValidation<ServerToolRound[]> {
  if (!Array.isArray(value)) return invalid('toolRounds must be an array')
  if (value.length > SERVER_TOOL_MAX_ROUNDS) {
    return invalid(`toolRounds must contain at most ${SERVER_TOOL_MAX_ROUNDS} rounds`)
  }
  const totalSize = validateTotalSize(value, 'toolRounds')
  if (totalSize.ok === false) return invalid(totalSize.error)

  const rounds: ServerToolRound[] = []
  for (const raw of value) {
    if (!plainRecord(raw)) return invalid('each tool round must be an object')
    if (typeof raw.assistantContent !== 'string' || utf8Bytes(raw.assistantContent) > SERVER_TOOL_MAX_RESULT_BYTES) {
      return invalid('each tool round must have bounded assistantContent')
    }
    const calls = validateServerToolCalls(raw.calls, allowedToolNames)
    if (calls.ok === false) return invalid(calls.error)
    if (!Array.isArray(raw.results) || raw.results.length !== calls.value.length) {
      return invalid('each tool round must contain exactly one result per call')
    }

    const callsById = new Map(calls.value.map((call) => [call.id, call]))
    const seenResults = new Set<string>()
    const results: ServerToolResult[] = []
    for (const result of raw.results) {
      if (!plainRecord(result)) return invalid('each tool result must be an object')
      if (
        typeof result.callId !== 'string' ||
        typeof result.name !== 'string' ||
        typeof result.content !== 'string' ||
        utf8Bytes(result.content) > SERVER_TOOL_MAX_RESULT_BYTES
      ) {
        return invalid('each tool result must contain bounded callId, name, and content strings')
      }
      const call = callsById.get(result.callId)
      if (!call || call.name !== result.name || seenResults.has(result.callId)) {
        return invalid(`tool result does not match a supplied call: ${result.callId}`)
      }
      seenResults.add(result.callId)
      results.push({ callId: result.callId, name: result.name, content: result.content })
    }
    rounds.push({ assistantContent: raw.assistantContent, calls: calls.value, results })
  }
  return { ok: true, value: rounds }
}
