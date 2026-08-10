import {
  getDatabase,
  type MessageGenerationInfo,
  type MessagePresetInfo,
  type character,
} from '../../storage/database.svelte'
import { trimUntilPunctuation } from '../../util'
import { withTrustedResourceWrite } from '../../server/resourceWriteGuard.svelte'
import { runInlayScreen } from '../inlayScreen'
import type { requestDataResponse } from '../request/request'
import { processScriptFull } from '../scripts'
import { sayTTS } from '../tts'
import {
  resolveStablePostGenerationChat,
  resolveStablePostGenerationMessage,
  stablePostGenerationMessageTarget,
  type StablePostGenerationChatTarget,
} from './stableTarget'

export interface ApplyNonStreamResponseOptions {
  req: requestDataResponse
  arg: { continue?: boolean }
  nowChatroom: character
  currentChar: character
  target: StablePostGenerationChatTarget | null
  generationId: string
  generationInfo: MessageGenerationInfo
  promptInfo: MessagePresetInfo
  reformatContent: (data: string) => string
  /**
   * When the server owns post-generation, skip `editoutput` here; the server runs
   * it. Server dispatch always streams, so this branch is local-only in practice.
   */
  skipEditOutput?: boolean
}

export interface ApplyNonStreamResponseResult {
  result: string
  emoChanged: boolean
  mrerolls: string[]
  messageId?: string
}

export async function applyNonStreamResponse(
  opts: ApplyNonStreamResponseOptions,
): Promise<ApplyNonStreamResponseResult> {
  const {
    req,
    arg,
    nowChatroom,
    currentChar,
    target,
    generationId,
    generationInfo,
    promptInfo,
    reformatContent,
    skipEditOutput,
  } = opts

  // `editoutput` runs server-side on the server-owned path; here it degrades to
  // the reformatted text (the server ships final text on `done`).
  const runEditOutput = (text: string, idx: number): Promise<{ data: string; emoChanged: boolean }> =>
    skipEditOutput
      ? Promise.resolve({ data: reformatContent(text), emoChanged: false })
      : processScriptFull(nowChatroom, reformatContent(text), 'editoutput', idx)

  const msgs = req.type === 'success' ? ([['char', req.result]] as const) : req.type === 'multiline' ? req.result : []

  let result = ''
  let emoChanged = false
  const mrerolls: string[] = []
  let outputMessageId: string | undefined

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    const mess = msg[1]
    const beforeResolution = resolveStablePostGenerationChat(target)
    if (!beforeResolution) break
    let msgIndex = beforeResolution.chat.message.length
    let targetMessageId = generationId
    if (i === 0 && arg.continue) {
      targetMessageId = beforeResolution.chat.message[msgIndex - 1]?.chatId ?? ''
      if (!targetMessageId) break
    }
    let result2 = await runEditOutput(mess, msgIndex)
    if (i === 0 && arg.continue) {
      msgIndex -= 1
      const messageTarget = stablePostGenerationMessageTarget(target?.characterId, target?.chatId, targetMessageId)
      const liveMessage = resolveStablePostGenerationMessage(messageTarget)?.message
      if (!liveMessage) break
      result2 = await runEditOutput(liveMessage.data + mess, msgIndex)
    }
    if (getDatabase().removeIncompleteResponse) {
      result2.data = trimUntilPunctuation(result2.data)
    }
    result = result2.data
    const inlayResult = runInlayScreen(currentChar, result)
    result = inlayResult.text
    emoChanged = result2.emoChanged
    if (i === 0 && arg.continue) {
      withTrustedResourceWrite(() => {
        const messageTarget = stablePostGenerationMessageTarget(target?.characterId, target?.chatId, targetMessageId)
        const resolution = resolveStablePostGenerationMessage(messageTarget)
        if (!resolution) return
        resolution.chat.message[resolution.messageIndex] = {
          role: 'char',
          data: result,
          saying: currentChar.chaId,
          time: Date.now(),
          generationInfo,
          promptInfo,
          chatId: targetMessageId,
        }
        outputMessageId = targetMessageId
      })
      if (inlayResult.promise) {
        const p = await inlayResult.promise
        withTrustedResourceWrite(() => {
          const messageTarget = stablePostGenerationMessageTarget(target?.characterId, target?.chatId, targetMessageId)
          const resolution = resolveStablePostGenerationMessage(messageTarget)
          if (resolution) resolution.message.data = p
        })
      }
    } else if (i === 0) {
      withTrustedResourceWrite(() => {
        const resolution = resolveStablePostGenerationChat(target)
        if (!resolution || !generationId) return
        resolution.chat.message.push({
          role: msg[0],
          data: result,
          saying: currentChar.chaId,
          time: Date.now(),
          generationInfo,
          promptInfo,
          chatId: generationId,
        })
        outputMessageId = generationId
      })
      if (inlayResult.promise) {
        const p = await inlayResult.promise
        withTrustedResourceWrite(() => {
          const messageTarget = stablePostGenerationMessageTarget(target?.characterId, target?.chatId, generationId)
          const resolution = resolveStablePostGenerationMessage(messageTarget)
          if (resolution) resolution.message.data = p
        })
      }
      mrerolls.push(result)
    } else {
      mrerolls.push(result)
    }
    withTrustedResourceWrite(() => {
      const resolution = resolveStablePostGenerationChat(target)
      if (resolution) resolution.character.reloadKeys += 1
    })
    if (getDatabase().ttsAutoSpeech) {
      await sayTTS(currentChar, result)
    }
  }

  return { result, emoChanged, mrerolls, ...(outputMessageId ? { messageId: outputMessageId } : {}) }
}
