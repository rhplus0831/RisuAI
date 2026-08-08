import type { InputHook, MessageTranslation } from '../storage/database.svelte'
import { sha256Hex } from '../sha256Fallback'

const DRAFT_HOOK_TRANSLATION_IDENTITY = 'draft-hook-original-translation-v1'

function draftHookSettingsIdentity(hook: InputHook): string {
  return JSON.stringify([
    DRAFT_HOOK_TRANSLATION_IDENTITY,
    hook.id,
    hook.prompt,
    hook.model?.mode ?? 'inheritOtherAx',
    hook.model?.mode === 'modelProfile' ? hook.model.profileId : '',
  ])
}

export async function createDraftHookTranslation(input: {
  hook: InputHook
  messageData: string
  originalText: string
  updatedAt?: number
}): Promise<MessageTranslation> {
  const [sourceHash, settingsHash] = await Promise.all([
    sha256Hex(input.messageData),
    sha256Hex(draftHookSettingsIdentity(input.hook)),
  ])

  return {
    text: input.originalText,
    source: 'raw',
    sourceHash,
    targetLanguage: 'original',
    inputLanguage: 'auto',
    translatorType: 'llm',
    settingsHash,
    updatedAt: input.updatedAt ?? Date.now(),
  }
}
