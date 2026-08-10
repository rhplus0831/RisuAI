import { get } from 'svelte/store'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  acceptedSendRecoveries,
  acknowledgeHydratedAcceptedSendRecoveries,
  recordAcceptedSendRecovery,
  transcriptHasReplyForAcceptedSend,
} from './acceptedSendRecoveryState'

const target = {
  selectedCharID: 0,
  chatPage: 0,
  characterId: 'character-a',
  chatId: 'chat-a',
}

beforeEach(() => {
  acceptedSendRecoveries.set([])
})

describe('accepted send recovery state', () => {
  it('recognizes only an adjacent assistant reply for the accepted user row', () => {
    expect(
      transcriptHasReplyForAcceptedSend(
        [
          { role: 'user', chatId: 'message-a' },
          { role: 'char', chatId: 'generation-a' },
        ],
        'message-a',
      ),
    ).toBe(true)
    expect(
      transcriptHasReplyForAcceptedSend(
        [
          { role: 'user', chatId: 'message-a' },
          { role: 'user', chatId: 'message-b' },
          { role: 'char', chatId: 'generation-b' },
        ],
        'message-a',
      ),
    ).toBe(false)
  })

  it('clears a stale recovery when authoritative hydration contains its reply', () => {
    recordAcceptedSendRecovery(
      {
        id: 'chat-a:message:message-a',
        target,
        messageId: 'message-a',
        syntheticSayNothing: false,
      },
      'generation_failed',
    )
    recordAcceptedSendRecovery(
      {
        id: 'chat-b:message:message-b',
        target: { ...target, chatId: 'chat-b' },
        messageId: 'message-b',
        syntheticSayNothing: false,
      },
      'generation_failed',
    )

    acknowledgeHydratedAcceptedSendRecoveries('chat-a', [
      { role: 'user', chatId: 'message-a' },
      { role: 'char', chatId: 'generation-a' },
    ])

    expect(get(acceptedSendRecoveries)).toEqual([
      expect.objectContaining({
        id: 'chat-b:message:message-b',
        target: expect.objectContaining({ chatId: 'chat-b' }),
      }),
    ])
  })
})
