import {
  validateServerToolCalls,
  type ServerToolCall,
  type ServerToolDefinition,
  type ServerToolRound,
  type ServerToolValidation,
} from '../../../../src/ts/process/request/serverToolProtocol.js'

type JsonRecord = Record<string, unknown>

function plainRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseArguments(value: unknown): JsonRecord | null {
  if (plainRecord(value)) return value
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value) as unknown
    return plainRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function invalid<T>(error: string): ServerToolValidation<T> {
  return { ok: false, error }
}

export function openAIToolDefinitions(tools: readonly ServerToolDefinition[]): JsonRecord[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }))
}

export function appendOpenAIToolRounds(messages: readonly unknown[], rounds: readonly ServerToolRound[]): unknown[] {
  const out = [...messages]
  for (const round of rounds) {
    out.push({
      role: 'assistant',
      content: round.assistantContent || null,
      tool_calls: round.calls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    })
    for (const result of round.results) {
      out.push({ role: 'tool', tool_call_id: result.callId, content: result.content })
    }
  }
  return out
}

export function anthropicToolDefinitions(tools: readonly ServerToolDefinition[]): JsonRecord[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }))
}

export function appendAnthropicToolRounds(messages: readonly unknown[], rounds: readonly ServerToolRound[]): unknown[] {
  const out = [...messages]
  for (const round of rounds) {
    out.push({
      role: 'assistant',
      content: [
        ...(round.assistantContent ? [{ type: 'text', text: round.assistantContent }] : []),
        ...round.calls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments })),
      ],
    })
    out.push({
      role: 'user',
      content: round.results.map((result) => ({
        type: 'tool_result',
        tool_use_id: result.callId,
        content: result.content,
      })),
    })
  }
  return out
}

export function geminiToolDefinitions(tools: readonly ServerToolDefinition[]): JsonRecord[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
    },
  ]
}

function geminiResponseContent(content: string): JsonRecord {
  try {
    return { data: JSON.parse(content) as unknown }
  } catch {
    return { data: content }
  }
}

export function appendGeminiToolRounds(contents: readonly unknown[], rounds: readonly ServerToolRound[]): unknown[] {
  const out = [...contents]
  for (const round of rounds) {
    out.push({
      role: 'model',
      parts: [
        ...(round.assistantContent ? [{ text: round.assistantContent }] : []),
        ...round.calls.map((call) => ({
          functionCall: { id: call.id, name: call.name, args: call.arguments },
          ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
        })),
      ],
    })
    out.push({
      role: 'user',
      parts: round.results.map((result) => ({
        functionResponse: {
          id: result.callId,
          name: result.name,
          response: geminiResponseContent(result.content),
        },
      })),
    })
  }
  return out
}

export function parseOpenAIToolCalls(
  value: unknown,
  allowedToolNames: ReadonlySet<string>,
): ServerToolValidation<ServerToolCall[]> {
  if (!Array.isArray(value) || value.length === 0) return invalid('provider returned no tool calls')
  const calls: ServerToolCall[] = []
  for (const raw of value) {
    if (!plainRecord(raw) || !plainRecord(raw.function)) return invalid('provider returned a malformed tool call')
    const args = parseArguments(raw.function.arguments)
    if (typeof raw.id !== 'string' || typeof raw.function.name !== 'string' || !args) {
      return invalid('provider returned a malformed tool call')
    }
    calls.push({ id: raw.id, name: raw.function.name, arguments: args })
  }
  return validateServerToolCalls(calls, allowedToolNames)
}

export function parseAnthropicToolCalls(
  value: unknown,
  allowedToolNames: ReadonlySet<string>,
): ServerToolValidation<ServerToolCall[]> {
  if (!Array.isArray(value)) return invalid('provider returned malformed Anthropic content')
  const calls: ServerToolCall[] = []
  for (const raw of value) {
    if (!plainRecord(raw) || raw.type !== 'tool_use') continue
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || !plainRecord(raw.input)) {
      return invalid('provider returned a malformed tool call')
    }
    calls.push({ id: raw.id, name: raw.name, arguments: raw.input })
  }
  if (calls.length === 0) return invalid('provider returned no tool calls')
  return validateServerToolCalls(calls, allowedToolNames)
}

export function parseGeminiToolCalls(
  value: unknown,
  allowedToolNames: ReadonlySet<string>,
): ServerToolValidation<ServerToolCall[]> {
  if (!Array.isArray(value)) return invalid('provider returned malformed Gemini parts')
  const calls: ServerToolCall[] = []
  let callIndex = 0
  for (const raw of value) {
    if (!plainRecord(raw) || !plainRecord(raw.functionCall)) continue
    const call = raw.functionCall
    if (typeof call.name !== 'string' || !plainRecord(call.args)) {
      return invalid('provider returned a malformed tool call')
    }
    const id = typeof call.id === 'string' && call.id.length > 0 ? call.id : `gemini-tool-call-${callIndex}`
    calls.push({
      id,
      name: call.name,
      arguments: call.args,
      ...(typeof raw.thoughtSignature === 'string' ? { thoughtSignature: raw.thoughtSignature } : {}),
    })
    callIndex += 1
  }
  if (calls.length === 0) return invalid('provider returned no tool calls')
  return validateServerToolCalls(calls, allowedToolNames)
}
