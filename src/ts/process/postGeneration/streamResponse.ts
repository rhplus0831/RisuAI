import type { MessageGenerationInfo, MessagePresetInfo, character } from '../../storage/database.svelte'
import { DBState } from '../../stores.svelte'
import { trimUntilPunctuation } from '../../util'
import { withTrustedServerProjectionWrite } from '../../server/projectionWriteGuard.svelte'
import type { StreamResponseChunk, requestDataResponse } from '../request/request'
import { processScriptFull } from '../scripts'
import { createStreamRenderCoalescer, type RenderFlushScheduler } from './streamCoalescer'

type StreamingResponse = Extract<requestDataResponse, { type: 'streaming' }>

export interface ConsumeStreamResponseOptions {
  req: StreamingResponse
  arg: { continue?: boolean }
  nowChatroom: character
  currentChar: character
  selectedChar: number
  selectedChat: number
  generationId: string
  generationInfo: MessageGenerationInfo
  promptInfo: MessagePresetInfo
  abortSignal: AbortSignal
  reformatContent: (data: string) => string
  /**
   * When the server owns post-generation, skip `editoutput` here; the server runs
   * it and ships final text on the terminal `done` frame. The browser still writes
   * streamed reformatted text for live display.
   */
  skipEditOutput?: boolean
  /**
   * Test seam: overrides the animation-frame scheduler the render coalescer
   * uses. Production callers omit it (`defaultRenderFlushScheduler`).
   */
  renderFlushScheduler?: RenderFlushScheduler
}

export interface ConsumeStreamResponseResult {
  result: string
  emoChanged: boolean
  msgIndex: number
  lastResponseChunk: StreamResponseChunk
  streamAborted: boolean
}

export async function consumeStreamResponse(opts: ConsumeStreamResponseOptions): Promise<ConsumeStreamResponseResult> {
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
    skipEditOutput,
  } = opts

  const reader = req.result.getReader()
  let msgIndex = DBState.db.characters[selectedChar].chats[selectedChat].message.length
  let prefix = ''
  if (arg.continue) {
    msgIndex -= 1
    prefix = DBState.db.characters[selectedChar].chats[selectedChat].message[msgIndex].data
  } else {
    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[selectedChar].chats[selectedChat].message.push({
        role: 'char',
        data: '',
        saying: currentChar.chaId,
        time: Date.now(),
        generationInfo,
        promptInfo,
        chatId: generationId,
      })
    })
  }
  withTrustedServerProjectionWrite(() => {
    DBState.db.characters[selectedChar].chats[selectedChat].isStreaming = true
    DBState.db.characters[selectedChar].reloadKeys += 1
  })
  let lastResponseChunk: StreamResponseChunk = {}
  let streamAborted: boolean = abortSignal.aborted
  let result = ''
  let emoChanged = false
  // Every `.data` write + `reloadKeys` bump re-runs
  // `risuChatParser` + `ParseMarkdown` over the whole growing message, so apply
  // the newest accumulated chunk at most once per animation frame instead of
  // once per token. `settle()` below guarantees the final full-fidelity apply
  // (including `editoutput`) before this function returns.
  const applyLatestChunk = async (): Promise<void> => {
    let nextData: string
    if (skipEditOutput) {
      // The server owns `editoutput`; write the reformatted stream for display
      // and defer final text to the terminal `done` frame.
      nextData = reformatContent(prefix + result)
    } else {
      const result2 = await processScriptFull(nowChatroom, reformatContent(prefix + result), 'editoutput', msgIndex)
      nextData = result2.data
      emoChanged = result2.emoChanged
    }
    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[selectedChar].chats[selectedChat].message[msgIndex].data = nextData
      DBState.db.characters[selectedChar].reloadKeys += 1
    })
  }
  const renderCoalescer = createStreamRenderCoalescer(applyLatestChunk, opts.renderFlushScheduler)
  const abortReader = () => {
    streamAborted = true
    void reader.cancel().catch(() => {})
  }
  abortSignal.addEventListener('abort', abortReader, { once: true })
  try {
    while (streamAborted === false) {
      let readed: ReadableStreamReadResult<StreamResponseChunk>
      try {
        readed = await reader.read()
      } catch (error) {
        if (abortSignal.aborted || streamAborted) {
          streamAborted = true
          break
        }
        throw error
      }
      if (readed.value) {
        lastResponseChunk = readed.value
        const firstChunkKey = Object.keys(lastResponseChunk)[0]
        result = lastResponseChunk[firstChunkKey]
        if (!result) {
          result = ''
        }
        if (DBState.db.removeIncompleteResponse) {
          result = trimUntilPunctuation(result)
        }
        renderCoalescer.notify()
        if (renderCoalescer.failed) {
          // An apply rejected (script error); stop reading and surface it via
          // `settle()` below, like the old per-chunk await failed fast.
          break
        }
      }
      if (readed.done) {
        break
      }
    }
    await renderCoalescer.settle()
  } finally {
    abortSignal.removeEventListener('abort', abortReader)
    // When the loop threw (reader error), still apply the last received chunk;
    // swallow apply errors here so they cannot mask the propagating one.
    await renderCoalescer.settle().catch(() => {})
    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[selectedChar].chats[selectedChat].isStreaming = false
      DBState.db.characters[selectedChar].reloadKeys += 1
    })
    void reader.cancel().catch(() => {})
  }

  return { result, emoChanged, msgIndex, lastResponseChunk, streamAborted }
}
