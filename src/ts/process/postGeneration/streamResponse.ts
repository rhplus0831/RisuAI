import type {
  MessageGenerationInfo,
  MessagePresetInfo,
  character,
} from '../../storage/database.svelte'
import { DBState } from '../../stores.svelte'
import { trimUntilPunctuation } from '../../util'
import { withTrustedServerProjectionWrite } from '../../server/projectionWriteGuard.svelte'
import type { StreamResponseChunk, requestDataResponse } from '../request/request'
import { processScriptFull } from '../scripts'

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
}

export interface ConsumeStreamResponseResult {
  result: string
  emoChanged: boolean
  msgIndex: number
  lastResponseChunk: StreamResponseChunk
  streamAborted: boolean
}

export async function consumeStreamResponse(
  opts: ConsumeStreamResponseOptions,
): Promise<ConsumeStreamResponseResult> {
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
        const result2 = await processScriptFull(
          nowChatroom,
          reformatContent(prefix + result),
          'editoutput',
          msgIndex,
        )
        withTrustedServerProjectionWrite(() => {
          DBState.db.characters[selectedChar].chats[selectedChat].message[msgIndex].data =
            result2.data
          DBState.db.characters[selectedChar].reloadKeys += 1
        })
        emoChanged = result2.emoChanged
      }
      if (readed.done) {
        break
      }
    }
  } finally {
    abortSignal.removeEventListener('abort', abortReader)
    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[selectedChar].chats[selectedChat].isStreaming = false
      DBState.db.characters[selectedChar].reloadKeys += 1
    })
    void reader.cancel().catch(() => {})
  }

  return { result, emoChanged, msgIndex, lastResponseChunk, streamAborted }
}
