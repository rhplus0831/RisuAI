import { addRerolls } from '../prereroll'
import { DBState } from '../../stores.svelte'
import { runInlayScreen } from '../inlayScreen'
import { sayTTS } from '../tts'
import { evaluateAutoContinue } from '../autoContinue'
import { evaluateIgp } from './igp'
import { applyOutputTrigger } from './outputTrigger'
import { applyNonStreamResponse } from './nonStreamResponse'
import { consumeStreamResponse } from './streamResponse'
import { withTrustedServerProjectionWrite } from '../../server/projectionWriteGuard.svelte'
import type {
  Chat,
  MessageGenerationInfo,
  MessagePresetInfo,
  character,
} from '../../storage/database.svelte'
import type { DispatchSuccessReq } from '../dispatch/dispatchRequest'

export type OrchestrateResponseResult =
  | { status: 'aborted' }
  | { status: 'continue'; resultTokens: number }
  | {
      status: 'done'
      currentChat: Chat
      result: string
      emoChanged: boolean
      resendChat: boolean
    }

/**
 * Subset of the sendChat `arg` parameter the orchestrator forwards onto the
 * stream / non-stream helpers and reads for auto-continue accounting.
 */
export interface OrchestrateResponseArg {
  continue?: boolean
  usedContinueTokens?: number
}

export interface OrchestrateResponseArgs {
  req: DispatchSuccessReq
  arg: OrchestrateResponseArg
  nowChatroom: character
  currentChar: character
  /** Mutated on the streaming branch (reassigned from triggerChat); the
   * non-streaming branch writes `triggerChat` directly to DB without
   * touching this local. Preserved verbatim. */
  currentChat: Chat
  selectedChar: number
  selectedChat: number
  generationId: string
  generationInfo: MessageGenerationInfo
  promptInfo: MessagePresetInfo
  abortSignal: AbortSignal
  reformatContent: (data: string) => string
  runCurrentChatFunction: (chat: Chat) => Chat
  suppressStreamingTts?: boolean
  /**
   * Slice 4 (A2): the server owns the post-generation derivation (`editoutput`,
   * the pre-trigger run-var pass, and the `'output'` trigger). When set, this
   * orchestrator relays the stream for live display only — it skips the
   * `editoutput` transform and `applyOutputTrigger`, and defers the inlay-screen
   * render + final-text write to `applyServerBackedTerminal`. The derived
   * scriptstate delta, final text, and resend request arrive on the terminal
   * `done.postGeneration`.
   */
  serverOwnsPostGeneration?: boolean
}

/**
 * Run the post-dispatch response stage: route to the streaming or
 * non-streaming response helper, apply the shared output-trigger, drive
 * the streaming-only inlay / TTS side effects, evaluate auto-continue, and
 * run IGP.
 *
 * Returns a discriminated union. The coordinator owns:
 *   - `status: 'continue'` → release `doingChat` lease, clear
 *     `iOwnDoingChat`, and recursively call `sendChat` with `continue: true`.
 *     The recursion cannot live in this helper without a circular import.
 *   - `status: 'aborted'`  → return false from sendChat.
 *   - `status: 'done'`     → continue into stage 4 with `currentChat`,
 *     `result`, `emoChanged`, `resendChat`.
 */
export async function orchestrateResponse(
  args: OrchestrateResponseArgs,
): Promise<OrchestrateResponseResult> {
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
    abortSignal,
    reformatContent,
    runCurrentChatFunction,
    suppressStreamingTts,
    serverOwnsPostGeneration,
  } = args
  let currentChat = args.currentChat
  let result = ''
  let emoChanged = false
  let resendChat = false

  if (req.type === 'streaming') {
    const stream = await consumeStreamResponse({
      req,
      arg,
      nowChatroom,
      currentChar,
      selectedChar,
      selectedChat,
      generationId,
      generationInfo,
      promptInfo,
      abortSignal,
      reformatContent,
      skipEditOutput: serverOwnsPostGeneration,
    })
    result = stream.result
    emoChanged = stream.emoChanged

    if (stream.streamAborted || abortSignal.aborted) {
      return { status: 'aborted' }
    }

    addRerolls(generationId, Object.values(stream.lastResponseChunk))

    if (serverOwnsPostGeneration) {
      // A2: the server already ran the run-var pass + `'output'` trigger +
      // `editoutput`. The browser keeps the streamed text for display; the
      // inlay-screen render over the server-owned final text, the scriptstate
      // patch, and the resend request are applied from the terminal
      // (`applyServerBackedTerminal`). Nothing durable to derive here.
      currentChat = DBState.db.characters[selectedChar].chats[selectedChat]
    } else {
      const streamTrigger = await applyOutputTrigger({
        currentChar,
        selectedChar,
        selectedChat,
        runCurrentChatFunction,
      })
      currentChat = streamTrigger.triggerChat ?? streamTrigger.chat
      if (streamTrigger.resendChat) {
        resendChat = true
      }
      const inlayr = runInlayScreen(currentChar, currentChat.message[stream.msgIndex].data)
      withTrustedServerProjectionWrite(() => {
        currentChat =
          streamTrigger.triggerChat ?? DBState.db.characters[selectedChar].chats[selectedChat]
        currentChat.message[stream.msgIndex].data = inlayr.text
        DBState.db.characters[selectedChar].chats[selectedChat] = currentChat
      })
      if (inlayr.promise) {
        const t = await inlayr.promise
        withTrustedServerProjectionWrite(() => {
          currentChat = DBState.db.characters[selectedChar].chats[selectedChat]
          currentChat.message[stream.msgIndex].data = t
          DBState.db.characters[selectedChar].chats[selectedChat] = currentChat
        })
      }
      if (DBState.db.ttsAutoSpeech && !suppressStreamingTts) {
        await sayTTS(currentChar, result)
      }
    }
  } else {
    const nonStream = await applyNonStreamResponse({
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
      skipEditOutput: serverOwnsPostGeneration,
    })
    result = nonStream.result
    emoChanged = nonStream.emoChanged
    if (nonStream.mrerolls.length > 1) {
      addRerolls(generationId, nonStream.mrerolls)
    }

    // A2: on the server-owned path the `'output'` trigger ran server-side; the
    // browser consumes the terminal patch instead of deriving it here. (Server
    // dispatch always streams, so this branch is local-only in practice.)
    if (!serverOwnsPostGeneration) {
      const nonStreamTrigger = await applyOutputTrigger({
        currentChar,
        selectedChar,
        selectedChat,
        runCurrentChatFunction,
      })
      if (nonStreamTrigger.triggerChat) {
        withTrustedServerProjectionWrite(() => {
          DBState.db.characters[selectedChar].chats[selectedChat] = nonStreamTrigger.triggerChat!
        })
      }
      if (nonStreamTrigger.resendChat) {
        resendChat = true
      }
    }
  }

  const { shouldContinue, resultTokens } = await evaluateAutoContinue({
    result,
    usedContinueTokens: arg.usedContinueTokens || 0,
    db: DBState.db,
  })

  if (shouldContinue) {
    return { status: 'continue', resultTokens }
  }

  await evaluateIgp({
    promptTemplate: DBState.db.igpPrompt ?? '',
    abortSignal,
    selectedChar,
    selectedChat,
  })

  return { status: 'done', currentChat, result, emoChanged, resendChat }
}
