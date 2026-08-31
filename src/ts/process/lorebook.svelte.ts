import { get } from 'svelte/store'
import { getChatVar, setChatVar } from '../parser/chatVar.svelte'
import { selectedCharID } from '../stores.svelte'
import { type character, type Chat, type Database, type Message, type loreBook } from '../storage/database.svelte'
import { tokenize } from '../tokenizer'
import { pickHashRand } from '../util'
import { selectSingleFile } from '../filePicker'
import { alertError, alertNormal } from '../alert'
import { language } from '../../lang'
import { downloadFile } from '../globalApi.svelte'
import { getModuleLorebooks } from './modules'
import { CCardLib } from '@risuai/ccardlib'
import { isAgentOnlyLorebookEntry } from '@risuai/shared-core/agent-only-lorebook'
import { v4 } from 'uuid'
import {
  ensureClientLorebookEntryIds,
  ensureGlobalLorebookListIds,
  isCharacterLorebookMutationReady,
  replaceCharacterLorebookCollectionWithOutcome,
  replaceChatLorebookCollectionWithOutcome,
  replaceGlobalLorebookEntryCollectionWithOutcome,
  type ScopedLorebookMutationOperation,
} from '../server/lorebookOwner.svelte'
import { lorebookEntriesForOriginalRisuExport } from '../agentLorebookInputs'
import { ensureCharacterLorebookHydrated } from '../server/chatMessageHydration.svelte'
import { risuChatParser } from '../parser/parser.svelte'
import { currentLorebookPageIndex } from '../server/lorebookPageOwner.svelte'
import {
  charactersResourceState,
  collectionsResourceState,
  getCharacterResourceOwner,
} from '../server/resourceState.svelte'
import { resolveActiveChatGenerationSettings } from '../activeChatGenerationSettings'

function selectedGlobalLorebookPage(): number {
  return currentLorebookPageIndex() ?? 0
}

function selectedCharacterOwner(): character | undefined {
  if (charactersResourceState.status !== 'ready') return undefined
  const candidate = charactersResourceState.characters[get(selectedCharID)]
  return candidate?.chaId ? getCharacterResourceOwner(candidate.chaId) : undefined
}

function exactChatOwner(characterId: string, chatId: string): Chat | undefined {
  const matches = getCharacterResourceOwner(characterId)?.chats?.filter((chat) => chat?.id === chatId) ?? []
  return matches.length === 1 ? matches[0] : undefined
}

type GlobalLorebookOwner = Database['loreBook'][number]

function globalLorebookOwners(): GlobalLorebookOwner[] {
  return collectionsResourceState.statuses.loreBook === 'ready'
    ? (collectionsResourceState.values.loreBook as GlobalLorebookOwner[])
    : []
}

function selectedGlobalLorebookOwner(): GlobalLorebookOwner | undefined {
  return globalLorebookOwners()[selectedGlobalLorebookPage()]
}

function ensureSelectedGlobalLorebookOwner(): GlobalLorebookOwner | undefined {
  // @legacy-compatibility Imported pre-owner databases may have books without
  // ids. The owner helper normalizes only this collection; subsequent access uses its
  // explicit collection owner.
  ensureGlobalLorebookListIds()
  return selectedGlobalLorebookOwner()
}

type StableLorebookImportTarget =
  | { mode: 'global'; characterId: string }
  | { mode: 'local'; characterId: string; chatId: string }
  | { mode: 'sglobal'; lorebookId: string }

function captureLorebookImportTarget(mode: 'global' | 'local' | 'sglobal'): StableLorebookImportTarget | null {
  if (mode === 'sglobal') {
    const lorebook = ensureSelectedGlobalLorebookOwner()
    return lorebook?.id ? { mode: 'sglobal', lorebookId: lorebook.id } : null
  }

  const character = selectedCharacterOwner()
  if (!character?.chaId) return null

  if (mode === 'global') {
    return { mode: 'global', characterId: character.chaId }
  }

  const chat = character.chats?.[character.chatPage]
  return chat?.id ? { mode: 'local', characterId: character.chaId, chatId: chat.id } : null
}

function resolveLorebookImportEntries(target: StableLorebookImportTarget): loreBook[] | null {
  switch (target.mode) {
    case 'global': {
      const character = getCharacterResourceOwner(target.characterId)
      return character ? (character.globalLore ?? []) : null
    }
    case 'local': {
      const chat = exactChatOwner(target.characterId, target.chatId)
      return chat ? (chat.localLore ?? []) : null
    }
    case 'sglobal': {
      const lorebook = globalLorebookOwners().find((candidate) => candidate.id === target.lorebookId)
      return lorebook ? (lorebook.data ?? []) : null
    }
  }
}

function replaceLorebookEntries(
  target: StableLorebookImportTarget,
  entries: loreBook[],
): ScopedLorebookMutationOperation | null {
  switch (target.mode) {
    case 'global':
      return replaceCharacterLorebookCollectionWithOutcome(target.characterId, entries)
    case 'local':
      return replaceChatLorebookCollectionWithOutcome(target.chatId, entries)
    case 'sglobal':
      return replaceGlobalLorebookEntryCollectionWithOutcome(target.lorebookId, entries)
  }
}

function newLorebookEntry(comment: string, key = '', mode: loreBook['mode'] = 'normal'): loreBook {
  return {
    id: v4(),
    key,
    comment,
    content: '',
    mode,
    insertorder: 100,
    alwaysActive: false,
    secondkey: '',
    selective: false,
  }
}

export function addLorebook(type: number): ScopedLorebookMutationOperation | null {
  const selectedCharacter = selectedCharacterOwner()
  if (type === 0) {
    if (!selectedCharacter?.chaId || !isCharacterLorebookMutationReady(selectedCharacter.chaId)) return null
    const entries = safeStructuredClone(selectedCharacter.globalLore ?? [])
    entries.push(newLorebookEntry(`New Lore ${entries.length + 1}`))
    return replaceCharacterLorebookCollectionWithOutcome(selectedCharacter.chaId, entries)
  } else if (type === -1) {
    const current = ensureSelectedGlobalLorebookOwner()
    if (!current?.id) return null
    const entries = safeStructuredClone(current.data ?? [])
    entries.push(newLorebookEntry(`New Lore ${entries.length + 1}`))
    return replaceGlobalLorebookEntryCollectionWithOutcome(current.id, entries)
  } else {
    const chat = selectedCharacter?.chats?.[selectedCharacter.chatPage]
    if (!chat?.id) return null
    const entries = safeStructuredClone(chat.localLore ?? [])
    entries.push(newLorebookEntry(`New Lore ${entries.length + 1}`))
    return replaceChatLorebookCollectionWithOutcome(chat.id, entries)
  }
}

export function addLorebookFolder(type: number): ScopedLorebookMutationOperation | null {
  const selectedCharacter = selectedCharacterOwner()
  const id = v4()
  if (type === 0) {
    if (!selectedCharacter?.chaId || !isCharacterLorebookMutationReady(selectedCharacter.chaId)) return null
    const entries = safeStructuredClone(selectedCharacter.globalLore ?? [])
    entries.push(newLorebookEntry('New Folder', '\uf000folder:' + id, 'folder'))
    return replaceCharacterLorebookCollectionWithOutcome(selectedCharacter.chaId, entries)
  } else if (type === -1) {
    const current = ensureSelectedGlobalLorebookOwner()
    if (!current?.id) return null
    const entries = safeStructuredClone(current.data ?? [])
    entries.push(newLorebookEntry('New Folder', '\uf000folder:' + id, 'folder'))
    return replaceGlobalLorebookEntryCollectionWithOutcome(current.id, entries)
  } else {
    const chat = selectedCharacter?.chats?.[selectedCharacter.chatPage]
    if (!chat?.id) return null
    const entries = safeStructuredClone(chat.localLore ?? [])
    entries.push(newLorebookEntry('New Folder', '\uf000folder:' + id, 'folder'))
    return replaceChatLorebookCollectionWithOutcome(chat.id, entries)
  }
}

export interface LorebookGenerationSnapshot {
  database: Database
  character: character
  chat: Chat
}

export async function loadLoreBookV3Prompt(snapshot?: LorebookGenerationSnapshot) {
  const generation =
    snapshot ??
    (() => {
      const state = resolveActiveChatGenerationSettings()
      if (!state.character || !state.chat) throw new Error('Active generation lorebook owner is unavailable')
      return { database: state.db, character: state.character, chat: state.chat }
    })()
  const db = generation.database
  const char = generation.character
  const chat = generation.chat
  const characterLore = char.globalLore ?? []
  const chatLore = chat.localLore ?? []
  const moduleLorebook = getModuleLorebooks({ database: db, character: char, chat })
  const fullLore = safeStructuredClone(
    characterLore
      .concat(chatLore)
      .concat(moduleLorebook)
      .filter((entry) => !isAgentOnlyLorebookEntry(entry)),
  )
  const currentChat = chat.message
  const loreDepth = char.loreSettings?.scanDepth ?? db.loreBookDepth
  const loreToken = char.loreSettings?.tokenBudget ?? db.loreBookToken
  const fullWordMatchingSetting = char.loreSettings?.fullWordMatching ?? false
  const chatLength = currentChat.length + 1 //includes first message
  const recursiveScanning = char.loreSettings?.recursiveScanning ?? true
  let recursivePrompt: {
    prompt: string
    source: string
    data: string
  }[] = []
  let matchLog: {
    prompt: string
    source: string
    activated: string
  }[] = []

  const searchMatch = (
    messages: Message[],
    arg: {
      keys: string[]
      searchDepth: number
      regex: boolean
      fullWordMatching: boolean
      all?: boolean
      dontSearchWhenRecursive: boolean
    },
  ) => {
    const sliced = messages.slice(messages.length - arg.searchDepth, messages.length)
    const newKeys = []
    for (const key of arg.keys) {
      const trimmed = key.trim()
      if (trimmed.length > 0) {
        newKeys.push(trimmed)
      }
    }
    arg.keys = newKeys
    let mList: {
      source: string
      prompt: string
      data: string
    }[] = sliced
      .map((msg, i) => {
        if (msg.role === 'user') {
          return {
            source: `message ${i} by user`,
            prompt: `\x01{{${db.username}}}:` + msg.data + '\x01',
            data: msg.data,
          }
        } else {
          return {
            source: `message ${i} by char`,
            prompt:
              `\x01{{${msg.name ?? (msg.saying ? db.characters.find((row) => row.chaId === msg.saying)?.name : null) ?? char.name}}}:` +
              msg.data +
              '\x01',
            data: msg.data,
          }
        }
      })
      .concat(
        arg.dontSearchWhenRecursive
          ? []
          : recursivePrompt.map((msg) => {
              return {
                source: 'lorebook ' + msg.source,
                prompt: msg.prompt,
                data: msg.data,
              }
            }),
      )

    if (arg.regex) {
      for (const mText of mList) {
        for (const regexString of arg.keys) {
          if (!regexString.startsWith('/')) {
            return false
          }
          const regexFlag = regexString.split('/').pop()
          if (regexFlag) {
            arg.keys[0] = regexString.replace('/' + regexFlag, '')
            try {
              const regex = new RegExp(arg.keys[0], regexFlag)
              const d = regex.test(mText.data)
              if (d) {
                matchLog.push({
                  prompt: mText.prompt,
                  source: mText.source,
                  activated: regexString,
                })
                return true
              }
            } catch (error) {
              return false
            }
          }
        }
      }
      return false
    }

    mList = mList.map((m) => {
      return {
        source: m.source,
        prompt: m.prompt
          .toLocaleLowerCase()
          .replace(/\{\{\/\/(.+?)\}\}/g, '')
          .replace(/\{\{comment:(.+?)\}\}/g, ''),
        data: m.data
          .toLocaleLowerCase()
          .replace(/\{\{\/\/(.+?)\}\}/g, '')
          .replace(/\{\{comment:(.+?)\}\}/g, ''),
      }
    })

    let allMode = arg.all ?? false
    let allModeMatched = true

    for (const m of mList) {
      let mText = m.data
      if (arg.fullWordMatching) {
        const splited = mText.split(' ')
        for (const key of arg.keys) {
          if (splited.includes(key.toLocaleLowerCase())) {
            matchLog.push({
              prompt: m.prompt,
              source: m.source,
              activated: key,
            })
            if (!allMode) {
              return true
            }
          } else if (allMode) {
            allModeMatched = false
          }
        }
      } else {
        mText = mText.replace(/ /g, '')
        for (const key of arg.keys) {
          const realKey = key.toLocaleLowerCase().replace(/ /g, '')
          if (mText.includes(realKey)) {
            matchLog.push({
              prompt: m.prompt,
              source: m.source,
              activated: key,
            })
            if (!allMode) {
              return true
            }
          } else if (allMode) {
            allModeMatched = false
          }
        }
      }
    }
    if (allMode && allModeMatched) {
      return true
    }
    return false
  }

  let matching = true
  let actives: {
    depth: number
    pos: string
    prompt: string
    role: 'system' | 'user' | 'assistant'
    order: number
    tokens: number
    priority: number
    source: string
    inject: {
      operation: 'append' | 'prepend' | 'replace'
      location: string
      param: string
      lore: boolean
    } | null
  }[] = []
  let activatedIndexes: number[] = []
  let disabledUIPrompts: string[] = []
  let matchTimes = 0
  let keepActivateAfterMatch = false
  let dontActivateAfterMatch = false
  while (matching) {
    matching = false
    for (let i = 0; i < fullLore.length; i++) {
      if (activatedIndexes.includes(i)) {
        continue
      }
      if (!fullLore[i].alwaysActive && !fullLore[i].key) {
        continue
      }
      let activated = true
      let pos = ''
      let inject: {
        operation: 'append' | 'prepend' | 'replace'
        location: string
        param: string
        lore: boolean
      } = null
      let depth = 0
      let scanDepth = loreDepth
      let order = fullLore[i].insertorder
      let priority = fullLore[i].insertorder
      let forceState: string = 'none'
      let role: 'system' | 'user' | 'assistant' = 'system'
      let searchQueries: {
        keys: string[]
        negative: boolean
        all?: boolean
      }[] = []
      let fullWordMatching = fullWordMatchingSetting
      let dontSearchWhenRecursive = false

      if (fullLore[i].mode === 'child') {
        activated = false
        for (let j = 0; j < i; j++) {
          if (fullLore[j].id === fullLore[i].id) {
            if (!activatedIndexes.includes(j)) {
              fullLore[i].comment = fullLore[j].comment
              fullLore[i].content = fullLore[j].content
              fullLore[i].alwaysActive = true
              activated = true
            }
            break
          }
        }
      }
      let itemRecursive: 'global' | true | false = 'global'
      const content = CCardLib.decorator.parse(fullLore[i].content, (name, arg) => {
        switch (name) {
          case 'end': {
            pos = 'depth'
            depth = 0
            return
          }
          case 'activate_only_after': {
            const int = parseInt(arg[0])
            if (Number.isNaN(int)) {
              return false
            }
            if (chatLength < int) {
              activated = false
            }
            return
          }
          case 'activate_only_every': {
            const int = parseInt(arg[0])
            if (Number.isNaN(int)) {
              return false
            }
            if (chatLength % int !== 0) {
              activated = false
            }
            return
          }
          case 'keep_activate_after_match': {
            const vara = getChatVar(
              '__internal_ka_' + (fullLore[i].id ?? pickHashRand(5555, fullLore[i].content).toString()),
            )
            if (vara === 'true') {
              forceState = 'activate'
            } else {
              keepActivateAfterMatch = true
            }
            return false
          }
          case 'dont_activate_after_match': {
            const vara = getChatVar(
              '__internal_da_' + (fullLore[i].id ?? pickHashRand(5555, fullLore[i].content).toString()),
            )
            if (vara === 'true') {
              forceState = 'deactivate'
            } else {
              dontActivateAfterMatch = true
            }
            return false
          }
          case 'depth':
          case 'reverse_depth': {
            const int = parseInt(arg[0])
            if (Number.isNaN(int)) {
              return false
            }
            depth = int
            pos = name === 'depth' ? 'depth' : 'reverse_depth'
            return
          }
          case 'instruct_depth':
          case 'reverse_instruct_depth':
          case 'instruct_scan_depth': {
            //the instruct mode does not exists in risu
            return false
          }
          case 'role': {
            if (arg[0] === 'user' || arg[0] === 'assistant' || arg[0] === 'system') {
              role = arg[0]
              return
            }
            return false
          }
          case 'scan_depth': {
            scanDepth = parseInt(arg[0])
            return
          }
          case 'is_greeting': {
            const int = parseInt(arg[0])
            if (Number.isNaN(int)) {
              return false
            }
            if ((chat.fmIndex ?? -1) + 1 !== int) {
              activated = false
            }
            return
          }
          case 'position': {
            if (arg[0].startsWith('pt_') || ['after_desc', 'before_desc', 'personality', 'scenario'].includes(arg[0])) {
              pos = arg[0]
              return
            }
            return false
          }
          case 'inject_lore': {
            inject ??= {
              operation: 'append',
              location: '',
              param: '',
              lore: true,
            }
            inject.location = arg.join(' ')
            inject.lore = true
            return
          }
          case 'inject_at': {
            inject ??= {
              operation: 'append',
              location: '',
              param: '',
              lore: false,
            }
            inject.location = arg.join(' ')
            inject.lore = false
            return
          }
          case 'inject_replace': {
            inject ??= {
              operation: 'replace',
              location: '',
              param: '',
              lore: false,
            }
            inject.operation = 'replace'
            inject.param = arg.join(' ')
            return
          }
          case 'inject_prepend': {
            inject ??= {
              operation: 'prepend',
              location: '',
              param: '',
              lore: false,
            }
            inject.operation = 'prepend'
            inject.param = arg.join(' ')
            return
          }
          case 'ignore_on_max_context': {
            priority = -1000
            return
          }
          case 'additional_keys': {
            searchQueries.push({
              keys: arg,
              negative: false,
            })
            return
          }
          case 'exclude_keys': {
            searchQueries.push({
              keys: arg,
              negative: true,
            })
            return
          }
          case 'exclude_keys_all': {
            searchQueries.push({
              keys: arg,
              negative: true,
              all: true,
            })
            return
          }
          case 'match_full_word': {
            fullWordMatching = true
            return
          }
          case 'match_partial_word': {
            fullWordMatching = false
            return
          }
          case 'is_user_icon': {
            return false
          }
          case 'activate': {
            forceState = 'activate'
            return
          }
          case 'dont_activate': {
            forceState = 'deactivate'
            return
          }
          case 'disable_ui_prompt': {
            if (['post_history_instructions', 'system_prompt'].includes(arg[0])) {
              disabledUIPrompts.push(arg[0])
              return
            }
            return false
          }
          case 'probability': {
            if (Math.random() * 100 > parseInt(arg[0])) {
              activated = false
            }
            return
          }
          case 'priority': {
            priority = parseInt(arg[0])
            return
          }
          //We can already do it with search depth, but its more readable and performant this way
          case 'unrecursive': {
            itemRecursive = false
            return
          }
          case 'recursive': {
            itemRecursive = true
            return
          }
          case 'no_recursive_search': {
            dontSearchWhenRecursive = true
            return
          }
          default: {
            return false
          }
        }
      })

      if (!activated || forceState !== 'none' || fullLore[i].alwaysActive) {
        //if the lore is not activated or force activated, skip the search
      } else {
        searchQueries.push({
          keys: fullLore[i].key.split(','),
          negative: false,
        })

        if (fullLore[i].secondkey && fullLore[i].selective) {
          searchQueries.push({
            keys: fullLore[i].secondkey.split(','),
            negative: false,
          })
        }

        for (const query of searchQueries) {
          const result = searchMatch(currentChat, {
            keys: query.keys,
            searchDepth: scanDepth,
            regex: fullLore[i].useRegex,
            fullWordMatching: fullWordMatching,
            all: query.all,
            dontSearchWhenRecursive: dontSearchWhenRecursive,
          })
          if (query.negative) {
            if (result) {
              activated = false
              break
            }
          } else {
            if (!result) {
              activated = false
              break
            }
          }
        }
      }

      if (forceState === 'activate') {
        activated = true
      } else if (forceState === 'deactivate') {
        activated = false
      }

      if (activated) {
        actives.push({
          depth: depth,
          pos: pos,
          prompt: content,
          role: role,
          order: order,
          // Count the text that reaches context. runVar stays false so cutoff
          // preflight cannot fire chat-variable writes such as {{setvar}}.
          tokens: await tokenize(risuChatParser(content, { chara: char })),
          priority: priority,
          source: fullLore[i].comment || `lorebook ${i}`,
          inject: inject ?? null,
        })
        activatedIndexes.push(i)

        if (keepActivateAfterMatch) {
          setChatVar('__internal_ka_' + (fullLore[i].id ?? pickHashRand(5555, fullLore[i].content).toString()), 'true')
        }
        if (dontActivateAfterMatch) {
          setChatVar('__internal_da_' + (fullLore[i].id ?? pickHashRand(5555, fullLore[i].content).toString()), 'true')
        }

        let recursive = recursiveScanning
        if (itemRecursive !== 'global') {
          recursive = itemRecursive
        }

        if (recursive) {
          matching = true
          recursivePrompt.push({
            prompt: content,
            data: content,
            source: fullLore[i].comment || `lorebook ${i}`,
          })
        }
      }
    }
  }

  const activesSorted = actives.sort((a, b) => {
    return b.priority - a.priority
  })

  let usedTokens = 0

  const activesFiltered = activesSorted.filter((act) => {
    if (usedTokens + act.tokens <= loreToken) {
      usedTokens += act.tokens
      return true
    }
    return false
  })

  let activesResorted = activesFiltered.sort((a, b) => {
    return b.order - a.order
  })

  const loreinjectionLores = activesResorted.filter((act) => {
    return act?.inject?.lore
  })

  activesResorted = activesResorted.filter((act) => {
    return !act?.inject?.lore
  })

  //I know this will make token count wrong, but performance is more important here

  for (const lore of loreinjectionLores) {
    const foundLoreIndex = activesResorted.findIndex((l) => {
      return l.source === lore.inject.location
    })
    if (foundLoreIndex !== -1) {
      const foundLore = activesResorted[foundLoreIndex]
      switch (lore.inject.operation) {
        case 'append': {
          foundLore.prompt += ' ' + lore.prompt
          break
        }
        case 'prepend': {
          foundLore.prompt = lore.prompt + ' ' + foundLore.prompt
          break
        }
        case 'replace': {
          foundLore.prompt = foundLore.prompt.replace(lore.inject.param, lore.prompt)
          break
        }
      }
    }
  }

  return {
    actives: activesResorted.reverse(),
    matchLog: matchLog,
  }
}

export async function importLoreBook(
  mode: 'global' | 'local' | 'sglobal',
): Promise<ScopedLorebookMutationOperation | null> {
  const target = captureLorebookImportTarget(mode)
  if (!target) return null

  const lorebook = (await selectSingleFile(['json', 'lorebook']))?.data
  if (!lorebook) {
    return null
  }

  try {
    const importedlore = JSON.parse(Buffer.from(lorebook).toString('utf-8'))
    if (!resolveLorebookImportEntries(target)) return null

    // Build the next entries from the stable target after parsing, so changes
    // made while the picker was open become part of the owner's rollback baseline.
    const current = resolveLorebookImportEntries(target)
    if (!current) return null

    const lore: loreBook[] = safeStructuredClone(current ?? [])
    if (importedlore.type === 'risu' && importedlore.data) {
      const datas: loreBook[] = importedlore.data
      for (const data of datas) {
        lore.push(data)
      }
    } else if (importedlore.entries) {
      const entries: { [key: string]: CCLorebook } = importedlore.entries
      lore.push(...convertExternalLorebook(entries))
    }
    ensureClientLorebookEntryIds(lore)
    return replaceLorebookEntries(target, lore)
  } catch (error) {
    alertError(error)
  }
  return null
}

export interface CCLorebook {
  key: string[]
  comment: string
  content: string
  order: number
  constant: boolean
  name: string
  keywords: string[]
  priority: number
  entry: string
  secondary_keys: string[]
  selective: boolean
  forceActivation: boolean
  keys: string[]
  displayName: string
  text: string
  contextConfig?: {
    budgetPriority: number
    prefix: string
    suffix: string
  }
}

export function convertExternalLorebook(entries: { [key: string]: CCLorebook }) {
  let lore: loreBook[] = []
  for (const key in entries) {
    const currentLore = entries[key]
    lore.push({
      key: currentLore.key
        ? currentLore.key.join(', ')
        : currentLore.keys
          ? currentLore.keys.join(', ')
          : currentLore.keywords
            ? currentLore.keywords.join(', ')
            : '',
      insertorder: currentLore.order ?? currentLore.priority ?? currentLore?.contextConfig?.budgetPriority ?? 0,
      comment: currentLore.comment || currentLore.name || currentLore.displayName || '',
      content: currentLore.content || currentLore.entry || currentLore.text || '',
      mode: 'normal',
      alwaysActive: currentLore.constant ?? currentLore.forceActivation ?? false,
      secondkey: currentLore.secondary_keys ? currentLore.secondary_keys.join(', ') : '',
      selective: currentLore.selective ?? false,
    })
  }
  return lore
}

export async function exportLoreBook(mode: 'global' | 'local' | 'sglobal') {
  try {
    let lore: loreBook[]
    if (mode === 'sglobal') {
      const owner = selectedGlobalLorebookOwner()
      if (!owner) return
      lore = owner.data
    } else {
      const selectedCharacter = selectedCharacterOwner()
      const characterId = selectedCharacter?.chaId
      if (!selectedCharacter || !characterId) return

      if (mode === 'global') {
        const hydrated = await ensureCharacterLorebookHydrated(characterId)
        if (!hydrated) {
          alertError(language.lorebookDataLoadFailed)
          return
        }
        // Selection may change while hydration is in flight. Export the stable
        // character the user originally requested, not the newly selected row.
        const character = getCharacterResourceOwner(characterId)
        if (!character) return
        lore = character.globalLore
      } else {
        const selectedChat = selectedCharacter.chats[selectedCharacter.chatPage]
        if (!selectedChat?.id) return
        const chat = exactChatOwner(characterId, selectedChat.id)
        if (!chat) return
        lore = chat.localLore
      }
    }
    const stringl = Buffer.from(
      JSON.stringify({
        type: 'risu',
        ver: 1,
        data: lorebookEntriesForOriginalRisuExport(lore),
      }),
      'utf-8',
    )

    await downloadFile(`lorebook_export.json`, stringl)

    alertNormal(language.successExport)
  } catch (error) {
    alertError(error)
  }
}
