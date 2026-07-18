import { describe, expect, it } from 'vitest'
import {
  captureChatButtonTriggerFreshness,
  chatButtonTriggerChatSignature,
  createChatButtonTriggerOperationTracker,
  resolveChatButtonTriggerFreshness,
  resolveChatButtonTriggerTargetAfterHydration,
  type ChatButtonTriggerTarget,
} from './chatButtonTriggerFreshness'

function baseTarget(overrides: Partial<ChatButtonTriggerTarget> = {}): ChatButtonTriggerTarget {
  return {
    selectedCharacterIndex: 0,
    characterId: 'char-a',
    chatPage: 1,
    chatId: 'chat-a',
    messageIndex: 2,
    messageId: 'message-c',
    messageData: 'source message',
    messageRole: 'char',
    transcriptLength: 3,
    tailMessageId: 'message-c',
    tailMessageData: 'source message',
    tailMessageRole: 'char',
    chatStateSignature: chatButtonTriggerChatSignature({
      id: 'chat-a',
      message: [
        { chatId: 'message-a', role: 'user', data: 'hello' },
        { chatId: 'message-b', role: 'char', data: 'hi' },
        { chatId: 'message-c', role: 'char', data: 'source message' },
      ],
    }),
    triggerName: 'manual-trigger',
    triggerId: 'button-id',
    btnEvent: null,
    ...overrides,
  }
}

function capture(target: ChatButtonTriggerTarget = baseTarget()) {
  const tracker = createChatButtonTriggerOperationTracker()
  const snapshot = captureChatButtonTriggerFreshness(target, tracker)
  return { tracker, snapshot }
}

describe('chat button trigger freshness', () => {
  it('accepts the same active rendered button target', () => {
    const target = baseTarget()
    const { tracker, snapshot } = capture(target)

    expect(resolveChatButtonTriggerFreshness(snapshot, target, tracker)).toEqual({ ok: true })
  })

  it('rejects a character switch', () => {
    const { tracker, snapshot } = capture()

    expect(
      resolveChatButtonTriggerFreshness(
        snapshot,
        baseTarget({ selectedCharacterIndex: 1, characterId: 'char-b' }),
        tracker,
      ),
    ).toEqual({ ok: false, reason: 'character-changed' })
  })

  it('rejects a chat switch', () => {
    const { tracker, snapshot } = capture()

    expect(resolveChatButtonTriggerFreshness(snapshot, baseTarget({ chatPage: 0, chatId: 'chat-b' }), tracker)).toEqual(
      {
        ok: false,
        reason: 'chat-changed',
      },
    )
  })

  it('rejects a message id or source change', () => {
    const { tracker, snapshot } = capture()

    expect(resolveChatButtonTriggerFreshness(snapshot, baseTarget({ messageId: 'message-replaced' }), tracker)).toEqual(
      { ok: false, reason: 'message-changed' },
    )

    expect(
      resolveChatButtonTriggerFreshness(snapshot, baseTarget({ messageData: 'newer source message' }), tracker),
    ).toEqual({ ok: false, reason: 'source-changed' })
  })

  it('rejects transcript changes', () => {
    const { tracker, snapshot } = capture()

    expect(
      resolveChatButtonTriggerFreshness(
        snapshot,
        baseTarget({
          transcriptLength: 4,
          tailMessageId: 'message-d',
          tailMessageData: 'new tail',
          chatStateSignature: chatButtonTriggerChatSignature({
            id: 'chat-a',
            message: [
              { chatId: 'message-a', role: 'user', data: 'hello' },
              { chatId: 'message-b', role: 'char', data: 'hi' },
              { chatId: 'message-c', role: 'char', data: 'source message' },
              { chatId: 'message-d', role: 'user', data: 'new tail' },
            ],
          }),
        }),
        tracker,
      ),
    ).toEqual({ ok: false, reason: 'transcript-changed' })
  })

  it('allows hydration-only transcript changes before a fresh recapture', () => {
    const { tracker, snapshot } = capture()

    expect(
      resolveChatButtonTriggerTargetAfterHydration(
        snapshot,
        baseTarget({
          chatStateSignature: chatButtonTriggerChatSignature({
            id: 'chat-a',
            message: [
              { chatId: 'message-a', role: 'user', data: 'hydrated hello' },
              { chatId: 'message-b', role: 'char', data: 'hi' },
              { chatId: 'message-c', role: 'char', data: 'source message' },
            ],
          }),
        }),
        tracker,
      ),
    ).toEqual({ ok: true })
  })

  it('still rejects a superseded operation after hydration', () => {
    const tracker = createChatButtonTriggerOperationTracker()
    const snapshot = captureChatButtonTriggerFreshness(baseTarget(), tracker)
    captureChatButtonTriggerFreshness(baseTarget(), tracker)

    expect(resolveChatButtonTriggerTargetAfterHydration(snapshot, baseTarget(), tracker)).toEqual({
      ok: false,
      reason: 'superseded-operation',
    })
  })

  it('rejects trigger identity changes', () => {
    const { tracker, snapshot } = capture()

    expect(resolveChatButtonTriggerFreshness(snapshot, baseTarget({ triggerName: 'other-trigger' }), tracker)).toEqual({
      ok: false,
      reason: 'trigger-changed',
    })
  })

  it('rejects a superseded operation token', () => {
    const tracker = createChatButtonTriggerOperationTracker()
    const snapshot = captureChatButtonTriggerFreshness(baseTarget(), tracker)
    captureChatButtonTriggerFreshness(baseTarget({ triggerName: 'newer-trigger' }), tracker)

    expect(resolveChatButtonTriggerFreshness(snapshot, baseTarget(), tracker)).toEqual({
      ok: false,
      reason: 'superseded-operation',
    })
  })
})
