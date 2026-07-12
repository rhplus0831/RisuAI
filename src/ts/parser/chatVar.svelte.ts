import { get } from 'svelte/store'
import { selectedCharID } from '../stores.svelte'
import { parseKeyValue } from '../util'
import { setChatVarBackend } from './chatVarBackend'
import { setParserStateBackend } from './parserStateBackend'
import { currentChatScriptstateSnapshot, dispatchCurrentChatScriptstatePatch } from '../chatCommands'
import { withTrustedServerProjectionWrite } from '../server/projectionWriteGuard.svelte'
import { getDatabase } from '../storage/database.svelte'

export function getChatVar(key: string): string {
  const selectedChar = get(selectedCharID)
  const char = getDatabase().characters[selectedChar]
  if (!char) {
    return 'null'
  }
  const chat = char.chats[char.chatPage]
  const state = chat.scriptstate?.['$' + key]
  if (state === undefined || state === null) {
    const defaultVariables = parseKeyValue(char.defaultVariables).concat(
      parseKeyValue(getDatabase().templateDefaultVariables),
    )
    const findResult = defaultVariables.find((f) => {
      return f[0] === key
    })
    if (findResult) {
      return findResult[1]
    }
    return 'null'
  }
  return state.toString()
}

export function setChatVar(key: string, value: string): void {
  const selectedChar = get(selectedCharID)
  const previous = currentChatScriptstateSnapshot()
  let updated = false
  withTrustedServerProjectionWrite(() => {
    const character = getDatabase().characters[selectedChar]
    const chat = character?.chats?.[character.chatPage]
    if (!chat) return
    const stateKey = '$' + key
    if (chat.scriptstate?.[stateKey] === value) return
    chat.scriptstate ??= {}
    chat.scriptstate[stateKey] = value
    updated = true
  })
  if (updated) {
    dispatchCurrentChatScriptstatePatch({ ['$' + key]: value }, [], previous)
  }
}

export function getGlobalChatVar(key: string): string {
  return getDatabase().globalChatVariables[key] ?? 'null'
}

setChatVarBackend({ getChatVar, setChatVar, getGlobalChatVar })
setParserStateBackend({
  getDefaultDatabase: () => getDatabase(),
  getDefaultSelectedCharID: () => get(selectedCharID),
})
