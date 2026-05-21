import { get } from 'svelte/store'
import { v4 } from 'uuid'
import { alertToast } from '../alert'
import {
  changeToPreset,
  type MessagePresetInfo,
  type character,
} from '../storage/database.svelte'
import { DBState } from '../stores.svelte'
import { selectedCharID } from '../stores.svelte'
import { ChatTokenizer } from '../tokenizer'
import { parseToggleSyntax } from '../util'
import { getModuleToggles } from './modules'

export interface SendChatContextResult {
  selectedChar: number
  selectedChat: number
  nowChatroom: character
  promptInfo: MessagePresetInfo
  tokenizer: ChatTokenizer
  maxContextTokens: number
}

/**
 * Run the sendChat entry-context setup: optional preset-chain switch on
 * fresh calls, stats counter, character + chat lookup, lastInteraction
 * stamp, chatId backfill, promptInfo seed (gated on
 * `promptInfoInsideChat`), and tokenizer creation. Mutates DBState
 * (`statics.messages`, character `lastInteraction`, message `chatId`)
 * and may call `changeToPreset` as a side effect.
 *
 * The coordinator handles the closures (`throwError`,
 * `runCurrentChatFunction`, etc.) and the `doingChat` lifecycle around
 * this helper.
 */
export function setupSendChatContext(args: {
  chatProcessIndex: number
  chatAdditonalTokens?: number
}): SendChatContextResult {
  const { chatProcessIndex, chatAdditonalTokens: argChatAdditonalTokens } = args

  if (chatProcessIndex === -1 && DBState.db.presetChain) {
    const names = DBState.db.presetChain.split(',').map((v) => v.trim())
    const randomSelect = Math.floor(Math.random() * names.length)
    const ele = names[randomSelect]

    const findId = DBState.db.botPresets.findIndex((v) => {
      return v.name === ele
    })

    if (findId === -1) {
      alertToast(`Cannot find preset: ${ele}`)
    } else {
      changeToPreset(findId, true)
    }
  }

  DBState.db.statics.messages += 1
  const selectedChar = get(selectedCharID)
  const nowChatroom = DBState.db.characters[selectedChar]
  nowChatroom.lastInteraction = Date.now()
  const selectedChat = nowChatroom.chatPage
  nowChatroom.chats[nowChatroom.chatPage].message = nowChatroom.chats[
    nowChatroom.chatPage
  ].message.map((v) => {
    v.chatId = v.chatId ?? v4()
    return v
  })

  let promptInfo: MessagePresetInfo = {}
  if (DBState.db.promptInfoInsideChat) {
    const initialPresetName = DBState.db.botPresets[DBState.db.botPresetsId]?.name ?? ''
    const initialPromptToggles = parseToggleSyntax(
      DBState.db.customPromptTemplateToggle + getModuleToggles(),
    ).flatMap((toggle) => {
      const raw = DBState.db.globalChatVariables[`toggle_${toggle.key}`]
      if (toggle.type === 'select' || toggle.type === 'text') {
        return [{ key: toggle.value, value: toggle.options[raw] }]
      }
      if (raw === '1') {
        return [{ key: toggle.value, value: 'ON' }]
      }
      return []
    })

    promptInfo = {
      promptName: initialPresetName,
      promptToggles: initialPromptToggles,
    }
  }

  let caculatedChatTokens = 0
  if (DBState.db.aiModel.startsWith('gpt')) {
    caculatedChatTokens += 5
  } else {
    caculatedChatTokens += 3
  }

  const chatAdditonalTokens = argChatAdditonalTokens ?? caculatedChatTokens
  const tokenizer = new ChatTokenizer(
    chatAdditonalTokens,
    DBState.db.aiModel.startsWith('gpt') ? 'noName' : 'name',
  )
  const maxContextTokens = DBState.db.maxContext

  return {
    selectedChar,
    selectedChat,
    nowChatroom,
    promptInfo,
    tokenizer,
    maxContextTokens,
  }
}
