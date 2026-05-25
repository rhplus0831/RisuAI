import { get } from 'svelte/store'
import { DBState, selectedCharID } from '../stores.svelte'
import { parseKeyValue } from '../util'
import { setChatVarBackend } from './chatVarBackend'
import { setParserStateBackend } from './parserStateBackend'
import { currentChatStateSnapshot, dispatchCurrentChatScriptstatePatch } from '../chatCommands'

export function getChatVar(key: string): string {
  const selectedChar = get(selectedCharID)
  const char = DBState.db.characters[selectedChar]
  if (!char) {
    return 'null'
  }
  const chat = char.chats[char.chatPage]
  const state = chat.scriptstate?.['$' + key]
  if (state === undefined || state === null) {
    const defaultVariables = parseKeyValue(char.defaultVariables).concat(
      parseKeyValue(DBState.db.templateDefaultVariables),
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
  const chat =
    DBState.db.characters[selectedChar]?.chats?.[DBState.db.characters[selectedChar].chatPage]
  if (!chat) return
  const previous = currentChatStateSnapshot()
  chat.scriptstate ??= {}
  chat.scriptstate['$' + key] = value
  dispatchCurrentChatScriptstatePatch({ ['$' + key]: value }, [], previous)
}

export function getGlobalChatVar(key: string): string {
  return DBState.db.globalChatVariables[key] ?? 'null'
}

setChatVarBackend({ getChatVar, setChatVar, getGlobalChatVar })
setParserStateBackend({
  getDefaultDatabase: () => DBState.db,
  getDefaultSelectedCharID: () => get(selectedCharID),
})
