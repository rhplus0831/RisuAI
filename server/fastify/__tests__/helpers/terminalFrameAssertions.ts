import { expect } from 'vitest'
import type { PromptChatEvent, PromptChatEventType } from '../../src/prompt/sseEvents.js'

export type PromptChatFrameType = PromptChatEventType | (string & {})

export interface PromptChatFrame {
  type: PromptChatFrameType
  data: Record<string, unknown>
}

type PromptChatFrameInput = string | readonly (PromptChatFrame | PromptChatEvent)[]

const TERMINAL_FRAME_TYPES = new Set<PromptChatFrameType>(['error', 'done'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseEventBlock(block: string, index: number): PromptChatFrame {
  let type: string | undefined
  const dataLines: string[] = []

  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) {
      type = line.slice('event: '.length)
    } else if (line.startsWith('data: ')) {
      dataLines.push(line.slice('data: '.length))
    }
  }

  if (!type) {
    throw new Error(`SSE frame ${index} is missing an event line: ${JSON.stringify(block)}`)
  }

  const rawData = dataLines.length > 0 ? dataLines.join('\n') : '{}'
  let data: unknown
  try {
    data = JSON.parse(rawData)
  } catch (err) {
    throw new Error(
      `SSE frame ${index} has invalid JSON data for event ${type}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (!isRecord(data)) {
    throw new Error(`SSE frame ${index} data for event ${type} must be a JSON object`)
  }

  return { type: type as PromptChatFrameType, data }
}

/** Parse an `event:`/`data:` SSE body into ordered `/generate/chat` frames. */
export function parseEvents(body: string): PromptChatFrame[] {
  return body
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n\n')
    .filter((block) => block.trim().length > 0)
    .map(parseEventBlock)
}

function normalizeFrame(frame: PromptChatFrame | PromptChatEvent, index: number): PromptChatFrame {
  if (!isRecord(frame) || typeof frame.type !== 'string') {
    throw new Error(`Frame ${index} must have a string type`)
  }
  if ('data' in frame && isRecord(frame.data)) {
    return { type: frame.type as PromptChatFrameType, data: frame.data }
  }

  const { type, ...data } = frame
  return { type: type as PromptChatFrameType, data }
}

export function normalizePromptChatFrames(input: PromptChatFrameInput): PromptChatFrame[] {
  if (typeof input === 'string') return parseEvents(input)
  return input.map(normalizeFrame)
}

function isTerminalFrame(frame: PromptChatFrame): boolean {
  return TERMINAL_FRAME_TYPES.has(frame.type)
}

function describeFrame(frame: PromptChatFrame, index: number): string {
  const details: string[] = []
  if (frame.type === 'error' && typeof frame.data.error === 'string') {
    details.push(`error=${JSON.stringify(frame.data.error)}`)
  }
  if (frame.type === 'done') {
    if (Object.hasOwn(frame.data, 'result')) details.push(`result=${JSON.stringify(frame.data.result)}`)
    if (Object.hasOwn(frame.data, 'postGeneration')) details.push('postGeneration')
  }
  return `${index}:${frame.type}${details.length > 0 ? `(${details.join(', ')})` : ''}`
}

export function frameSequence(input: PromptChatFrameInput): string {
  return normalizePromptChatFrames(input).map(describeFrame).join(' -> ')
}

export function expectFrameOrder(
  input: PromptChatFrameInput,
  expectedTypes: readonly PromptChatFrameType[],
): PromptChatFrame[] {
  const frames = normalizePromptChatFrames(input)
  expect(
    frames.map((frame) => frame.type),
    `frame order mismatch: ${frameSequence(frames)}`,
  ).toEqual(expectedTypes)
  return frames
}

export function expectSingleTerminal(input: PromptChatFrameInput): PromptChatFrame {
  const frames = normalizePromptChatFrames(input)
  const terminals = frames.map((frame, index) => ({ frame, index })).filter(({ frame }) => isTerminalFrame(frame))

  expect(
    terminals.map(({ frame }) => frame.type),
    `expected exactly one terminal frame: ${frameSequence(frames)}`,
  ).toHaveLength(1)
  expect(terminals[0]?.index, `terminal frame must be the final frame: ${frameSequence(frames)}`).toBe(
    frames.length - 1,
  )

  return terminals[0]!.frame
}

export function expectTerminalDone(input: PromptChatFrameInput): PromptChatFrame {
  const terminal = expectSingleTerminal(input)
  expect(terminal.type, `expected terminal done: ${frameSequence(input)}`).toBe('done')
  return terminal
}

export function expectTerminalErrorThenDone(input: PromptChatFrameInput): PromptChatFrame[] {
  const frames = normalizePromptChatFrames(input)
  const terminals = frames.map((frame, index) => ({ frame, index })).filter(({ frame }) => isTerminalFrame(frame))

  expect(
    terminals.map(({ frame }) => frame.type),
    `expected terminal error then done: ${frameSequence(frames)}`,
  ).toEqual(['error', 'done'])
  expect(
    terminals.map(({ index }) => index),
    `terminal error and done must be adjacent final frames: ${frameSequence(frames)}`,
  ).toEqual([frames.length - 2, frames.length - 1])

  return terminals.map(({ frame }) => frame)
}

function isSuccessDone(frame: PromptChatFrame): boolean {
  return (
    frame.type === 'done' &&
    frame.data.outcome !== 'cancelled' &&
    (Object.hasOwn(frame.data, 'result') || Object.hasOwn(frame.data, 'postGeneration'))
  )
}

export function expectNoSuccessDoneAfterAbort(input: PromptChatFrameInput): PromptChatFrame[] {
  const frames = normalizePromptChatFrames(input)
  const successDoneFrames = frames.filter(isSuccessDone)
  expect(
    successDoneFrames.map((frame, index) => describeFrame(frame, index)),
    `aborted stream must not emit success done frames: ${frameSequence(frames)}`,
  ).toEqual([])
  return frames
}
