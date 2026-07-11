import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

vi.mock('./modules', async (importActual) => {
  const actual = await importActual<typeof import('./modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import '../stores.svelte'
import { safeStructuredClone } from '../polyfill'
import { setServerProjectionWriteGuardEnabled } from '../server/projectionWriteGuard.svelte'
import { CurrentTriggerIdStore, DBState, selectedCharID } from '../stores.svelte'
import type { character } from '../storage/database.svelte'
import { createTriggerExecutionBudget, runTrigger } from './triggers'

function seedDb(): void {
  selectedCharID.set(0)
  DBState.db = {
    characters: [
      {
        chaId: 'char-a',
        name: 'Character',
        desc: '',
        chatPage: 0,
        chats: [{ id: 'chat-1', message: [], note: '', name: 'main', localLore: [], scriptstate: {} }],
        triggerscript: [],
        defaultVariables: '',
        globalLore: [],
        type: 'character',
      },
    ],
    characterOrder: [],
    templateDefaultVariables: '',
  } as any
}

function characterWithTriggers(triggerscript: unknown[]): character {
  return { ...DBState.db.characters[0], triggerscript } as unknown as character
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).safeStructuredClone = safeStructuredClone
  setServerProjectionWriteGuardEnabled(false)
  CurrentTriggerIdStore.set(null)
  seedDb()
})

afterEach(() => {
  CurrentTriggerIdStore.set(null)
  selectedCharID.set(-1)
})

describe('client trigger execution budget (L38)', () => {
  it('L38: manual v2Loop stops at the shared client trigger budget', async () => {
    const char = characterWithTriggers([
      {
        comment: 'spin',
        type: 'manual',
        conditions: [],
        effect: [
          { type: 'v2Loop', indent: 0 },
          {
            type: 'v2SetVar',
            var: 'loopCount',
            operator: '+=',
            valueType: 'value',
            value: '1',
            indent: 1,
          },
          { type: 'v2EndIndent', endOfLoop: true, indent: 1 },
        ],
      },
    ])
    const budget = createTriggerExecutionBudget({
      wallClockMs: Number.POSITIVE_INFINITY,
      maxEffectSteps: 1000,
      maxLoopBackEdges: 3,
    })

    const result = await runTrigger(char, 'manual', {
      chat: char.chats[char.chatPage],
      manualName: 'spin',
      triggerBudget: budget,
      deferLiveChatSideEffects: true,
    })

    expect(result?.triggerStoppedReason).toBe('loopBackEdges')
    expect(budget.stoppedReason).toBe('loopBackEdges')
    expect(Number(result?.chat.scriptstate?.$loopCount)).toBeGreaterThan(0)
  })

  it('L38: manual trigger abort signal interrupts v2Wait before later effects', async () => {
    const char = characterWithTriggers([
      {
        comment: 'wait',
        type: 'manual',
        conditions: [],
        effect: [
          { type: 'v2Wait', valueType: 'value', value: '1', indent: 0 },
          {
            type: 'v2SetVar',
            var: 'afterWait',
            operator: '=',
            valueType: 'value',
            value: 'ran',
            indent: 0,
          },
        ],
      },
    ])
    const budget = createTriggerExecutionBudget({
      wallClockMs: Number.POSITIVE_INFINITY,
      maxEffectSteps: 1000,
      maxLoopBackEdges: 1000,
    })
    const controller = new AbortController()

    const run = runTrigger(char, 'manual', {
      chat: char.chats[char.chatPage],
      manualName: 'wait',
      signal: controller.signal,
      triggerBudget: budget,
      deferLiveChatSideEffects: true,
    })
    setTimeout(() => controller.abort(), 0)

    const result = await run

    expect(result?.triggerStoppedReason).toBe('aborted')
    expect(budget.stoppedReason).toBe('aborted')
    expect(result?.chat.scriptstate?.$afterWait).toBeUndefined()
  })

  it('L38: manual v2Wait wakes at the wall-clock budget without an abort signal', async () => {
    const char = characterWithTriggers([
      {
        comment: 'wait-budget',
        type: 'manual',
        conditions: [],
        effect: [
          { type: 'v2Wait', valueType: 'value', value: '1', indent: 0 },
          {
            type: 'v2SetVar',
            var: 'afterBudgetWait',
            operator: '=',
            valueType: 'value',
            value: 'ran',
            indent: 0,
          },
        ],
      },
    ])
    const budget = createTriggerExecutionBudget({
      wallClockMs: 1,
      maxEffectSteps: 1000,
      maxLoopBackEdges: 1000,
    })

    const result = await runTrigger(char, 'manual', {
      chat: char.chats[char.chatPage],
      manualName: 'wait-budget',
      triggerBudget: budget,
      deferLiveChatSideEffects: true,
    })

    expect(result?.triggerStoppedReason).toBe('wallClock')
    expect(budget.stoppedReason).toBe('wallClock')
    expect(result?.chat.scriptstate?.$afterBudgetWait).toBeUndefined()
  })

  it('L38: completed manual trigger keeps trigger id for post-run display refresh', async () => {
    const char = characterWithTriggers([
      {
        comment: 'show-id',
        type: 'manual',
        conditions: [],
        effect: [
          {
            type: 'v2SetVar',
            var: 'ran',
            operator: '=',
            valueType: 'value',
            value: 'yes',
            indent: 0,
          },
        ],
      },
    ])
    CurrentTriggerIdStore.set('previous-id')

    const result = await runTrigger(char, 'manual', {
      chat: char.chats[char.chatPage],
      manualName: 'show-id',
      triggerId: 'button-42',
      deferLiveChatSideEffects: true,
    })

    expect(result?.triggerStoppedReason).toBeUndefined()
    expect(result?.chat.scriptstate?.$ran).toBe('yes')
    expect(get(CurrentTriggerIdStore)).toBe('button-42')
  })
})
