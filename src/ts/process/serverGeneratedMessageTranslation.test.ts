import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

vi.mock('../platform', async (importActual) => {
  const actual = await importActual<typeof import('../platform')>()
  return { ...actual, isFastifyServer: true }
})

vi.mock('./modules', async (importActual) => {
  const actual = await importActual<typeof import('./modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

import { getResourceDatabase, replaceResourceDatabase } from '../server/resourceState.svelte'
import {
  activeMessageTranslations,
  clearActiveMessageTranslation,
  setActiveMessageTranslations,
} from '../server/messageTranslationJobs'
import {
  automaticTranslationMessageIds,
  isClientAutomaticTranslationEligible,
  replaceAutomaticTranslationMessageIds,
  resetAutomaticTranslationEligibilityForTests,
  serverOwnedGeneratedMessageIds,
} from './generatedMessageTranslationEligibility'
import { handleServerGeneratedMessageTranslation } from './serverGeneratedMessageTranslation'

const translation = {
  source: 'raw' as const,
  text: 'translated reply',
  sourceHash: 'source-hash',
  targetLanguage: 'ko',
  inputLanguage: 'en',
  translatorType: 'google' as const,
  settingsHash: 'settings-hash',
  updatedAt: 123,
}

function seedMessage(): void {
  replaceResourceDatabase({
    characters: [
      {
        chaId: 'char-1',
        chatPage: 0,
        chats: [
          {
            id: 'chat-1',
            message: [{ role: 'char', data: 'generated reply', chatId: 'message-1' }],
          },
        ],
      },
    ],
  } as never)
  replaceAutomaticTranslationMessageIds(['message-1'])
}

beforeEach(() => {
  resetAutomaticTranslationEligibilityForTests()
  clearActiveMessageTranslation('message-1')
  setActiveMessageTranslations([])
  seedMessage()
})

afterEach(() => {
  resetAutomaticTranslationEligibilityForTests()
  clearActiveMessageTranslation('message-1')
  setActiveMessageTranslations([])
})

describe('server-generated message translation frames', () => {
  it('consumes client eligibility and applies a succeeded translation before generation settles', () => {
    handleServerGeneratedMessageTranslation('chat-1', {
      messageId: 'message-1',
      translation: { status: 'succeeded', jobId: 'job-1', translation },
    })

    expect(isClientAutomaticTranslationEligible('message-1')).toBe(false)
    expect(get(automaticTranslationMessageIds)).toEqual([])
    expect(get(serverOwnedGeneratedMessageIds).has('message-1')).toBe(true)
    expect(getResourceDatabase().characters[0]?.chats[0]?.message[0]?.translation).toEqual(translation)
    expect(get(activeMessageTranslations)).toContainEqual({
      chatId: 'chat-1',
      messageId: 'message-1',
      jobId: 'job-1',
      status: 'succeeded',
    })
  })

  it('publishes the existing failed-job UX state without leaving a running spinner', () => {
    handleServerGeneratedMessageTranslation('chat-1', {
      messageId: 'message-1',
      translation: { status: 'failed', jobId: 'job-failed', error: 'provider failed' },
    })

    expect(get(activeMessageTranslations)).toEqual([
      {
        chatId: 'chat-1',
        messageId: 'message-1',
        jobId: 'job-failed',
        status: 'failed',
        error: 'provider failed',
      },
    ])
  })

  it('seeds a capped running job for spinner and bootstrap polling recovery', () => {
    handleServerGeneratedMessageTranslation('chat-1', {
      messageId: 'message-1',
      translation: { status: 'running', jobId: 'job-running' },
    })

    expect(get(activeMessageTranslations)).toEqual([
      {
        chatId: 'chat-1',
        messageId: 'message-1',
        jobId: 'job-running',
        status: 'running',
      },
    ])
  })

  it('retains a generated-id fence when done beats the appended-row eligibility effect', () => {
    replaceAutomaticTranslationMessageIds([])
    handleServerGeneratedMessageTranslation('chat-1', { messageId: 'message-1' })

    // Simulate Chats.svelte observing the append after the done handler.
    replaceAutomaticTranslationMessageIds(['message-1'])
    expect(isClientAutomaticTranslationEligible('message-1')).toBe(false)
  })
})
