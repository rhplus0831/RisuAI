import {
  getDatabase,
  type Chat,
  type MessageGenerationInfo,
  type MessagePresetInfo,
  type character,
} from '../../storage/database.svelte'
import { trimUntilPunctuation } from '../../util'
import { withTrustedServerProjectionWrite } from '../../server/projectionWriteGuard.svelte'
import { runInlayScreen } from '../inlayScreen'
import type { requestDataResponse } from '../request/request'
import { processScriptFull } from '../scripts'
import { sayTTS } from '../tts'

export interface ApplyNonStreamResponseOptions {
  req: requestDataResponse
  arg: { continue?: boolean }
  nowChatroom: character
  currentChar: character
  selectedChar: number
  selectedChat: number
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
}

export async function applyNonStreamResponse(
  opts: ApplyNonStreamResponseOptions,
): Promise<ApplyNonStreamResponseResult> {
  const {
    req,
    arg,
    nowChatroom,
    currentChar,
    selectedChar,
    selectedChat,
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

  const messagesAt = (): Chat['message'] => getDatabase().characters[selectedChar].chats[selectedChat].message

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    const mess = msg[1]
    let msgIndex = messagesAt().length
    let result2 = await runEditOutput(mess, msgIndex)
    if (i === 0 && arg.continue) {
      msgIndex -= 1
      const beforeChat = messagesAt()[msgIndex]
      result2 = await runEditOutput(beforeChat.data + mess, msgIndex)
    }
    if (getDatabase().removeIncompleteResponse) {
      result2.data = trimUntilPunctuation(result2.data)
    }
    result = result2.data
    const inlayResult = runInlayScreen(currentChar, result)
    result = inlayResult.text
    emoChanged = result2.emoChanged
    if (i === 0 && arg.continue) {
      withTrustedServerProjectionWrite(() => {
        messagesAt()[msgIndex] = {
          role: 'char',
          data: result,
          saying: currentChar.chaId,
          time: Date.now(),
          generationInfo,
          promptInfo,
          chatId: generationId,
        }
      })
      if (inlayResult.promise) {
        const p = await inlayResult.promise
        withTrustedServerProjectionWrite(() => {
          messagesAt()[msgIndex].data = p
        })
      }
    } else if (i === 0) {
      withTrustedServerProjectionWrite(() => {
        messagesAt().push({
          role: msg[0],
          data: result,
          saying: currentChar.chaId,
          time: Date.now(),
          generationInfo,
          promptInfo,
          chatId: generationId,
        })
      })
      const ind = messagesAt().length - 1
      if (inlayResult.promise) {
        const p = await inlayResult.promise
        withTrustedServerProjectionWrite(() => {
          messagesAt()[ind].data = p
        })
      }
      mrerolls.push(result)
    } else {
      mrerolls.push(result)
    }
    withTrustedServerProjectionWrite(() => {
      getDatabase().characters[selectedChar].reloadKeys += 1
    })
    if (getDatabase().ttsAutoSpeech) {
      await sayTTS(currentChar, result)
    }
  }

  return { result, emoChanged, mrerolls }
}
