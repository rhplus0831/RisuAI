import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
import { getResourceDatabase as getDatabase } from '../../server/resourceState.svelte'
import { selectedCharID } from '../../stores.svelte'
import type { Message } from '../../storage/database.svelte'
import { chatProcessStage, doingChat } from '../index.svelte'
import { get } from 'svelte/store'
import { getProviderCalls } from './providerFake'
import { getSideEffectCalls, type SideEffectCall } from './sideEffects'

const HERE = dirname(fileURLToPath(import.meta.url))

export interface FixtureSnapshot {
  messages: NormalizedMessage[]
  generationInfo?: unknown
  stages: number[]
  sideEffects: SideEffectCall[]
  providerCalls: NormalizedProviderCall[]
  doingChat: boolean
}

interface NormalizedProviderCall {
  /** Second positional arg to requestChatData (e.g. 'model', 'emotion'). */
  mode: unknown
  /** OpenAIChat[] sent as arg.formated. The main pin for prompt-shape fixtures. */
  formated: unknown
  continue?: boolean
  chatId?: string
  biasString?: unknown
  useStreaming?: boolean
  imageResponse?: boolean
  previewBody?: boolean
  escape?: boolean
}

interface NormalizedMessage {
  role: Message['role']
  data: string
  saying?: string
  generationInfo?: unknown
  promptInfo?: unknown
  chatId?: string
}

/**
 * Subscribe to chatProcessStage and return a getter for the recorded sequence.
 * The first emitted value (the subscriber's snapshot at subscribe time) is
 * dropped so we only see writes that happen after we start recording.
 */
export function recordStages(): { stop: () => number[] } {
  const stages: number[] = []
  let first = true
  const unsub = chatProcessStage.subscribe((v) => {
    if (first) {
      first = false
      return
    }
    stages.push(v)
  })
  return {
    stop() {
      unsub()
      return stages
    },
  }
}

/** Strip nondeterministic fields from a message. */
function normalizeMessage(msg: Message): NormalizedMessage {
  const out: NormalizedMessage = {
    role: msg.role,
    data: msg.data,
  }
  if (msg.saying !== undefined) out.saying = msg.saying
  if (msg.chatId !== undefined) out.chatId = msg.chatId
  if (msg.generationInfo !== undefined) out.generationInfo = normalizeGenerationInfo(msg.generationInfo)
  if (msg.promptInfo !== undefined) out.promptInfo = msg.promptInfo
  return out
}

function normalizeGenerationInfo(info: unknown): unknown {
  if (!info || typeof info !== 'object') return info
  const cloned = JSON.parse(JSON.stringify(info))
  // Stage timings are wall-clock durations; with fake timers they end up as 0
  // already, but normalize defensively.
  if (cloned.stageTiming) {
    cloned.stageTiming = {
      stage1: 0,
      stage2: 0,
      stage3: 0,
      stage4: 0,
    }
  }
  return cloned
}

function normalizeProviderCall(call: { arg: unknown; model: unknown }): NormalizedProviderCall {
  const arg = (call.arg ?? {}) as Record<string, unknown>
  // Deep-clone so we don't mutate the live provider state.
  const cloned = JSON.parse(JSON.stringify(arg)) as Record<string, unknown>
  const out: NormalizedProviderCall = {
    mode: call.model,
    formated: cloned.formated,
  }
  // Only include other fields when they carry signal — e.g. don't emit
  // continue: false on every call. Keep the field set tight so snapshot
  // diffs are easy to read.
  if (cloned.continue) out.continue = true
  if (typeof cloned.chatId === 'string') out.chatId = cloned.chatId
  if (cloned.biasString !== undefined && (cloned.biasString as unknown[]).length > 0) {
    out.biasString = cloned.biasString
  }
  if (cloned.useStreaming === true) out.useStreaming = true
  if (cloned.imageResponse === true) out.imageResponse = true
  if (cloned.previewBody === true) out.previewBody = true
  if (cloned.escape === true) out.escape = true
  return out
}

export function captureSnapshot(stages: number[]): FixtureSnapshot {
  const charIdx = get(selectedCharID)
  const char = getDatabase().characters[charIdx]
  const chat = char.chats[char.chatPage]
  const lastAssistant = [...chat.message].reverse().find((m) => m.role === 'char')

  return {
    messages: chat.message.map(normalizeMessage),
    ...(lastAssistant?.generationInfo !== undefined
      ? { generationInfo: normalizeGenerationInfo(lastAssistant.generationInfo) }
      : {}),
    stages,
    sideEffects: getSideEffectCalls(),
    providerCalls: getProviderCalls().map(normalizeProviderCall),
    doingChat: get(doingChat),
  }
}

/**
 * Compare against `expected/<name>.json`. When the file does not exist (or
 * UPDATE_FIXTURES=1 is set), write the captured snapshot instead.
 */
export async function assertOrRecord(name: string, captured: FixtureSnapshot): Promise<void> {
  const path = resolve(HERE, 'expected', `${name}.json`)
  const shouldUpdate = process.env.UPDATE_FIXTURES === '1'

  let existing: FixtureSnapshot | null = null
  try {
    existing = JSON.parse(await readFile(path, 'utf8')) as FixtureSnapshot
  } catch {
    existing = null
  }

  if (existing === null || shouldUpdate) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(captured, null, 2) + '\n', 'utf8')
    if (existing === null) {
      // Fail loudly the first time so a developer notices a new fixture got
      // auto-recorded rather than silently passing.
      throw new Error(`Recorded new fixture snapshot at ${path}. Re-run tests to assert against it.`)
    }
    return
  }

  expect(captured).toEqual(existing)
}
