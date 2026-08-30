import { describe, expect, it } from 'vitest'
import {
  SERVER_TOOL_MAX_ARGUMENT_BYTES,
  SERVER_TOOL_MAX_CALLS_PER_ROUND,
  SERVER_TOOL_MAX_DEFINITIONS,
  SERVER_TOOL_MAX_PAYLOAD_BYTES,
  SERVER_TOOL_MAX_RESULT_BYTES,
  SERVER_TOOL_MAX_ROUNDS,
  SERVER_TOOL_MAX_SCHEMA_BYTES,
  validateServerToolCalls,
  validateServerToolDefinitions,
  validateServerToolRounds,
} from '@risuai/protocol/server-tool'

const tool = {
  name: 'risu.lookup:v1',
  description: 'Look up a record.',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
}
const allowed = new Set([tool.name])
const call = { id: 'call-1', name: tool.name, arguments: { id: 'mira' }, thoughtSignature: 'signed' }
const result = { callId: call.id, name: call.name, content: '{"name":"Mira"}' }

describe('server-tool protocol', () => {
  it('publishes the compatibility limits', () => {
    expect({
      definitions: SERVER_TOOL_MAX_DEFINITIONS,
      calls: SERVER_TOOL_MAX_CALLS_PER_ROUND,
      rounds: SERVER_TOOL_MAX_ROUNDS,
      schemaBytes: SERVER_TOOL_MAX_SCHEMA_BYTES,
      argumentBytes: SERVER_TOOL_MAX_ARGUMENT_BYTES,
      resultBytes: SERVER_TOOL_MAX_RESULT_BYTES,
      payloadBytes: SERVER_TOOL_MAX_PAYLOAD_BYTES,
    }).toEqual({
      definitions: 64,
      calls: 8,
      rounds: 4,
      schemaBytes: 64 * 1024,
      argumentBytes: 64 * 1024,
      resultBytes: 64 * 1024,
      payloadBytes: 512 * 1024,
    })
  })

  it('normalizes definitions, calls, and matched rounds without retaining extra fields', () => {
    expect(validateServerToolDefinitions([{ ...tool, ignored: true }])).toEqual({ ok: true, value: [tool] })
    expect(validateServerToolCalls([{ ...call, ignored: true }], allowed)).toEqual({ ok: true, value: [call] })
    expect(
      validateServerToolRounds(
        [{ assistantContent: '', calls: [call], results: [{ ...result, ignored: true }], ignored: true }],
        allowed,
      ),
    ).toEqual({ ok: true, value: [{ assistantContent: '', calls: [call], results: [result] }] })
  })

  it.each(['', 'spaces are unsafe', 'slash/name', 'emoji-🧠', 'a'.repeat(129)])(
    'rejects the provider-unsafe tool name %j',
    (name) => {
      expect(validateServerToolDefinitions([{ ...tool, name }])).toEqual({
        ok: false,
        error: 'each tool name must be a bounded provider-safe string',
      })
    },
  )

  it('rejects duplicate definitions and calls', () => {
    expect(validateServerToolDefinitions([tool, tool])).toEqual({
      ok: false,
      error: `duplicate tool name: ${tool.name}`,
    })
    expect(validateServerToolCalls([call, call], allowed)).toEqual({
      ok: false,
      error: `duplicate tool call id: ${call.id}`,
    })
  })

  it('rejects non-object, cyclic, and over-limit schemas and arguments', () => {
    expect(validateServerToolDefinitions([{ ...tool, inputSchema: [] }])).toEqual({
      ok: false,
      error: `tool ${tool.name} must have a bounded object inputSchema`,
    })
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(validateServerToolDefinitions([{ ...tool, inputSchema: cyclic }])).toEqual({
      ok: false,
      error: 'tools must be JSON serializable',
    })
    expect(
      validateServerToolDefinitions([{ ...tool, inputSchema: { value: 'x'.repeat(SERVER_TOOL_MAX_SCHEMA_BYTES) } }]),
    ).toEqual({
      ok: false,
      error: `tool ${tool.name} must have a bounded object inputSchema`,
    })
    expect(validateServerToolCalls([{ ...call, arguments: [] }], allowed)).toEqual({
      ok: false,
      error: `tool call ${call.id} must have bounded object arguments`,
    })
  })

  it('enforces definition, call, and round count bounds', () => {
    expect(validateServerToolDefinitions(Array.from({ length: SERVER_TOOL_MAX_DEFINITIONS + 1 }, () => tool))).toEqual({
      ok: false,
      error: `tools must contain at most ${SERVER_TOOL_MAX_DEFINITIONS} definitions`,
    })
    expect(validateServerToolCalls([], allowed)).toEqual({
      ok: false,
      error: `toolCalls must contain between 1 and ${SERVER_TOOL_MAX_CALLS_PER_ROUND} calls`,
    })
    expect(
      validateServerToolRounds(
        Array.from({ length: SERVER_TOOL_MAX_ROUNDS + 1 }, () => ({})),
        allowed,
      ),
    ).toEqual({
      ok: false,
      error: `toolRounds must contain at most ${SERVER_TOOL_MAX_ROUNDS} rounds`,
    })
  })

  it('rejects unavailable tools and oversized thought signatures', () => {
    expect(validateServerToolCalls([call], new Set())).toEqual({
      ok: false,
      error: `tool call requested an unavailable tool: ${tool.name}`,
    })
    expect(
      validateServerToolCalls(
        [{ ...call, thoughtSignature: '🧠'.repeat(SERVER_TOOL_MAX_ARGUMENT_BYTES / 2 + 1) }],
        allowed,
      ),
    ).toEqual({
      ok: false,
      error: `tool call ${call.id} must have a bounded thoughtSignature when provided`,
    })
  })

  it('requires one matching result for every call', () => {
    expect(validateServerToolRounds([{ assistantContent: '', calls: [call], results: [] }], allowed)).toEqual({
      ok: false,
      error: 'each tool round must contain exactly one result per call',
    })
    expect(
      validateServerToolRounds(
        [{ assistantContent: '', calls: [call], results: [{ ...result, callId: 'different' }] }],
        allowed,
      ),
    ).toEqual({ ok: false, error: 'tool result does not match a supplied call: different' })
    expect(
      validateServerToolRounds(
        [{ assistantContent: '', calls: [call], results: [{ ...result, name: 'different' }] }],
        allowed,
      ),
    ).toEqual({ ok: false, error: `tool result does not match a supplied call: ${call.id}` })
  })

  it('enforces UTF-8 result and aggregate payload byte bounds', () => {
    expect(
      validateServerToolRounds(
        [{ assistantContent: '🧠'.repeat(SERVER_TOOL_MAX_RESULT_BYTES / 2 + 1), calls: [call], results: [result] }],
        allowed,
      ),
    ).toEqual({ ok: false, error: 'each tool round must have bounded assistantContent' })

    const oversized = Array.from({ length: SERVER_TOOL_MAX_CALLS_PER_ROUND }, (_, index) => ({
      id: `call-${index}`,
      name: tool.name,
      arguments: { value: 'x'.repeat(SERVER_TOOL_MAX_ARGUMENT_BYTES - 20) },
    }))
    expect(validateServerToolCalls(oversized, allowed)).toEqual({
      ok: false,
      error: `toolCalls exceeds the ${SERVER_TOOL_MAX_PAYLOAD_BYTES}-byte limit`,
    })
  })
})
