import { get } from 'svelte/store'
import { CharEmotion, selectedCharID, VariableReloadGUIPointer } from '../stores.svelte'
import {
  type character,
  type customscript,
  getDatabase,
  getCurrentCharacter,
  getCurrentChat,
} from '../storage/database.svelte'
import { downloadFile } from '../globalApi.svelte'
import { alertError, alertNormal } from '../alert'
import { language } from 'src/lang'
import { selectSingleFile } from 'src/ts/filePicker'
import {
  assetRegex,
  type CbsConditions,
  risuChatParser as risuChatParserOrg,
  type simpleCharacterArgument,
} from '../parser/parser.svelte'
import { getModuleAssets, getModuleRegexScripts } from './modules'
import { HypaProcesser } from './memory/hypamemory'
import { runLuaEditTrigger } from './scriptings'
import { pluginV2 } from '../plugins/plugins.svelte'
import { runTrigger } from './triggers'
import { withTrustedResourceWrite } from '../server/resourceWriteGuard.svelte'
import { canUseServerCommands } from '../server/commands'
import { currentChatScopedSnapshot, dispatchUpdateMessageScoped } from '../chatCommands'
import { getActivePromptPresetRegexScripts } from './promptPresetRegex'
import { registerScriptCacheResetter } from './scriptCacheInvalidation'

const dreg = /{{data}}/g
const randomness = /\|\|\|/g

export type ScriptMode = 'editinput' | 'editoutput' | 'editprocess' | 'editdisplay'

type pScript = {
  script: customscript
  order: number
  actions: string[]
}

function isProcessableCustomScript(script: unknown): script is customscript {
  return (
    !!script &&
    typeof script === 'object' &&
    !Array.isArray(script) &&
    typeof (script as Partial<customscript>).type === 'string' &&
    typeof (script as Partial<customscript>).in === 'string' &&
    typeof (script as Partial<customscript>).out === 'string'
  )
}

function getProcessableCustomScripts(scripts: unknown): customscript[] {
  return Array.isArray(scripts) ? scripts.filter(isProcessableCustomScript) : []
}

export async function processScript(
  char: character,
  data: string,
  mode: ScriptMode,
  cbsConditions: CbsConditions = {},
) {
  return (await processScriptFull(char, data, mode, -1, cbsConditions)).data
}

export function exportRegex(s?: customscript[]) {
  let db = getDatabase()
  const script = s ?? db.globalscript
  const data = Buffer.from(
    JSON.stringify({
      type: 'regex',
      data: script,
    }),
    'utf-8',
  )
  downloadFile(`regexscript_export.json`, data)
  alertNormal(language.successExport)
}

type RegexImportFilePicker = typeof selectSingleFile

export async function importRegexRows(
  selectFile: RegexImportFilePicker = selectSingleFile,
): Promise<customscript[] | null> {
  let selected: Awaited<ReturnType<typeof selectSingleFile>>
  try {
    selected = await selectFile(['json'])
  } catch (error) {
    alertError(error)
    return null
  }

  if (!selected?.data) {
    return null
  }

  try {
    const filedata = selected.data
    const imported = JSON.parse(Buffer.from(filedata).toString('utf-8'))
    if (imported.type === 'regex' && Array.isArray(imported.data)) {
      const rows = normalizeImportedRegexRows(imported.data)
      if (rows) return rows
    }

    alertError(language.errors.noData)
  } catch (error) {
    alertError(error)
  }

  return null
}

function normalizeImportedRegexRows(rows: unknown[]): customscript[] | null {
  const normalized: customscript[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null
    const source = row as Record<string, unknown>
    const comment = source.comment ?? ''
    const input = source.in ?? ''
    const output = source.out ?? ''
    const type = source.type ?? 'editinput'

    if (
      typeof comment !== 'string' ||
      typeof input !== 'string' ||
      typeof output !== 'string' ||
      typeof type !== 'string'
    ) {
      return null
    }
    if (source.id != null && typeof source.id !== 'string') return null
    if (source.flag != null && typeof source.flag !== 'string') return null
    if (source.ableFlag != null && typeof source.ableFlag !== 'boolean') return null

    const next = { ...source, comment, in: input, out: output, type } as unknown as customscript
    if (source.id == null) delete next.id
    if (source.flag == null) delete next.flag
    if (source.ableFlag == null) delete next.ableFlag
    normalized.push(next)
  }
  return normalized
}

export async function importRegex(
  o?: customscript[],
  selectFile: RegexImportFilePicker = selectSingleFile,
): Promise<customscript[]> {
  const rows = await importRegexRows(selectFile)
  if (!rows || rows.length === 0) {
    return o ?? []
  }

  return [...(o ?? []), ...rows]
}

const BEST_MATCH_CACHE_LIMIT = 1000

let bestMatchCache = new Map<string, string>()
let processScriptCache = new Map<string, string>()

function generateScriptCacheKey(
  scripts: customscript[],
  data: string,
  mode: ScriptMode,
  chatID = -1,
  cbsConditions: CbsConditions = {},
  cacheScope = '',
) {
  return JSON.stringify([
    'process-script-cache-v2',
    data,
    mode,
    cacheScope,
    chatID,
    scripts
      .filter((script) => script.type === mode)
      .map((script) => [
        script.flag?.includes('<cbs>') ? risuChatParser(script.in, { chatID, cbsConditions }) : script.in,
        script.out,
        script.flag ?? '',
        script.ableFlag === true,
      ]),
  ])
}

function cacheScript(hash: string, result: string) {
  processScriptCache.set(hash, result)

  if (processScriptCache.size > 1000) {
    processScriptCache.delete(processScriptCache.keys().next().value)
  }
}

function getScriptCache(hash: string) {
  return processScriptCache.get(hash)
}

// Exported for render-cache regression tests; not part of the public API.
export function hasProcessScriptCacheEntryForTesting(
  scripts: customscript[],
  data: string,
  mode: ScriptMode,
  chatID = -1,
  cbsConditions: CbsConditions = {},
) {
  return processScriptCache.has(
    generateScriptCacheKey(scripts, data, mode, chatID, cbsConditions, currentScriptCacheScope(mode)),
  )
}

function currentScriptCacheScope(mode: ScriptMode) {
  if (mode !== 'editdisplay') return ''
  try {
    const chat = getCurrentChat()
    return JSON.stringify({
      selectedChar: get(selectedCharID),
      chatId: chat?.id,
      scriptstate: chat?.scriptstate ?? null,
      variableReloadEpoch: get(VariableReloadGUIPointer),
    })
  } catch {
    return JSON.stringify({
      selectedChar: get(selectedCharID),
      chatId: null,
      scriptstate: null,
      variableReloadEpoch: get(VariableReloadGUIPointer),
    })
  }
}

function cacheBestMatch(cacheKey: string, bestMatch: string) {
  bestMatchCache.delete(cacheKey)
  bestMatchCache.set(cacheKey, bestMatch)

  if (bestMatchCache.size > BEST_MATCH_CACHE_LIMIT) {
    const oldestKey = bestMatchCache.keys().next().value
    if (oldestKey !== undefined) {
      bestMatchCache.delete(oldestKey)
    }
  }
}

function getBestMatch(cacheKey: string) {
  const cached = bestMatchCache.get(cacheKey)
  if (cached !== undefined) {
    bestMatchCache.delete(cacheKey)
    bestMatchCache.set(cacheKey, cached)
  }
  return cached
}

// Exported for the best-match cache regression tests; not part of the public API.
export function cacheBestMatchForTesting(cacheKey: string, bestMatch: string) {
  cacheBestMatch(cacheKey, bestMatch)
}

export function getBestMatchForTesting(cacheKey: string) {
  return getBestMatch(cacheKey)
}

export function getBestMatchCacheSizeForTesting() {
  return bestMatchCache.size
}

function selectedChatMessage(chatID: number) {
  const selchar = getDatabase().characters?.[get(selectedCharID)]
  const chat = selchar?.chats?.[selchar.chatPage]
  return chat?.message?.[chatID]
}

function applyInjectMutation(data: string, mode: ScriptMode, chatID: number) {
  if (mode === 'editdisplay' || chatID === -1) return

  if (canUseServerCommands()) {
    const messageId = selectedChatMessage(chatID)?.chatId
    if (!messageId) return

    const previous = currentChatScopedSnapshot()
    let updated = false
    withTrustedResourceWrite(() => {
      const message = selectedChatMessage(chatID)
      if (!message || message.chatId !== messageId) return
      message.data = data
      updated = true
    })

    if (updated) {
      dispatchUpdateMessageScoped(messageId, { data }, previous, { optimisticPatchAlreadyApplied: true })
    }
    return
  }

  withTrustedResourceWrite(() => {
    const message = selectedChatMessage(chatID)
    if (message) {
      message.data = data
    }
  })
}

// Regex-script sources are constant across the per-token streaming re-runs that
// miss the script cache, so compiling `new RegExp(source, flag)` on every
// `executeScript` is pure waste. Memoize the compiled regex keyed by its source
// and flags. The cached instance's only mutable state is `lastIndex`, which we
// reset on every retrieval so a reused (possibly global/sticky) regex behaves
// exactly like a freshly compiled one.
let compiledRegexCache = new Map<string, RegExp>()

// Exported for the regex-cache regression test; not part of the public API.
export function getCompiledRegex(source: string, flag: string): RegExp {
  const key = `${flag}|||${source}`
  let reg = compiledRegexCache.get(key)
  if (!reg) {
    reg = new RegExp(source, flag)
    compiledRegexCache.set(key, reg)
    if (compiledRegexCache.size > 1000) {
      compiledRegexCache.delete(compiledRegexCache.keys().next().value)
    }
  }
  reg.lastIndex = 0
  return reg
}

export function resetScriptCache() {
  bestMatchCache = new Map()
  processScriptCache = new Map()
  compiledRegexCache = new Map()
}

registerScriptCacheResetter(resetScriptCache)

export async function processScriptFull(
  char: character | simpleCharacterArgument,
  data: string,
  mode: ScriptMode,
  chatID = -1,
  cbsConditions: CbsConditions = {},
) {
  let db = getDatabase()
  let emoChanged = false
  data = await runLuaEditTrigger(char, mode, data, { index: chatID })

  if (mode === 'editdisplay') {
    const currentChar = getCurrentCharacter()
    if (currentChar) {
      try {
        const d = await runTrigger(currentChar, 'display', {
          chat: getCurrentChat(),
          displayMode: true,
          displayData: data,
        })

        data = d?.displayData ?? data
      } catch (e) {
        console.error(e)
      }
    }
  }

  if (pluginV2[mode].size > 0) {
    for (const plugin of pluginV2[mode]) {
      const res = await plugin(data)
      if (res !== null && res !== undefined) {
        data = res
      }
    }
  }

  data = risuChatParser(data, { chatID: chatID, cbsConditions })
  const scripts = getProcessableCustomScripts(db.globalscript)
    .concat(getProcessableCustomScripts(getActivePromptPresetRegexScripts(db)))
    .concat(getProcessableCustomScripts((char as { customscript?: unknown }).customscript))
    .concat(getProcessableCustomScripts(getModuleRegexScripts()))
  const hash = generateScriptCacheKey(scripts, data, mode, chatID, cbsConditions, currentScriptCacheScope(mode))
  const cached = getScriptCache(hash)
  if (cached) {
    return { data: cached, emoChanged: false }
  }

  if (scripts.length === 0) {
    cacheScript(hash, data)
    return { data, emoChanged }
  }
  function executeScript(pscript: pScript) {
    const script = pscript.script

    if (script.in === '') {
      return
    }

    if (script.type === mode) {
      let outScript2 = script.out.replaceAll('$n', '\n')
      let outScript = outScript2.replace(dreg, '$&')
      let flag = 'g'
      if (script.ableFlag) {
        flag = script.flag || 'g'
      }
      if (
        outScript.startsWith('@@move_top') ||
        outScript.startsWith('@@move_bottom') ||
        pscript.actions.includes('move_top') ||
        pscript.actions.includes('move_bottom')
      ) {
        flag = flag.replace('g', '')
      }
      if (outScript.endsWith('>') && !pscript.actions.includes('no_end_nl')) {
        outScript += '\n'
      }
      //remove unsupported flag
      flag = flag.trim().replace(/[^dgimsuvy]/g, '')

      //remove repeated flags
      flag = flag
        .split('')
        .filter((v, i, a) => a.indexOf(v) === i)
        .join('')

      if (flag.length === 0) {
        flag = 'u'
      }

      let input = script.in
      if (pscript.actions.includes('cbs')) {
        input = risuChatParser(input, { chatID: chatID, cbsConditions })
      }

      const reg = getCompiledRegex(input, flag)
      if (outScript.startsWith('@@') || pscript.actions.length > 0) {
        if (reg.test(data)) {
          if (outScript.startsWith('@@emo ')) {
            const emoName = script.out.substring(6).trim()
            let charemotions = get(CharEmotion)
            let tempEmotion = charemotions[char.chaId]
            if (!tempEmotion) {
              tempEmotion = []
            }
            if (tempEmotion.length > 4) {
              tempEmotion.splice(0, 1)
            }
            if (char.type !== 'simple') {
              for (const emo of char.emotionImages) {
                if (emo[0] === emoName) {
                  const emos: [string, string, number] = [emo[0], emo[1], Date.now()]
                  tempEmotion.push(emos)
                  charemotions[char.chaId] = tempEmotion
                  CharEmotion.set(charemotions)
                  emoChanged = true
                  break
                }
              }
            }
          } else if (outScript.startsWith('@@inject') || pscript.actions.includes('inject')) {
            applyInjectMutation(data, mode, chatID)
            data = data.replace(reg, '')
          } else if (
            outScript.startsWith('@@move_top') ||
            outScript.startsWith('@@move_bottom') ||
            pscript.actions.includes('move_top') ||
            pscript.actions.includes('move_bottom')
          ) {
            const isGlobal = flag.includes('g')
            const matchAll = isGlobal ? data.matchAll(reg) : [data.match(reg)]
            data = data.replace(reg, '')
            for (const matched of matchAll) {
              if (matched) {
                const inData = matched[0]
                let out = outScript
                  .replace('@@move_top ', '')
                  .replace('@@move_bottom ', '')
                  .replace(/(?<!\$)\$[0-9]+/g, (v) => {
                    const index = parseInt(v.substring(1))
                    if (index < matched.length) {
                      return matched[index]
                    }
                    return v
                  })
                  .replace(/\$\&/g, inData)
                  .replace(/(?<!\$)\$<([^>]+)>/g, (v) => {
                    const groupName = parseInt(v.substring(2, v.length - 1))
                    if (matched.groups && matched.groups[groupName]) {
                      return matched.groups[groupName]
                    }
                    return v
                  })
                if (outScript.startsWith('@@move_top') || pscript.actions.includes('move_top')) {
                  data = out + '\n' + data
                } else {
                  data = data + '\n' + out
                }
              }
            }
          } else {
            data = risuChatParser(data.replace(reg, outScript), { chatID: chatID, cbsConditions })
          }
        } else {
          if ((outScript.startsWith('@@repeat_back') || pscript.actions.includes('repeat_back')) && chatID !== -1) {
            const v = outScript.split(' ', 2)[1]
            const selchar = db.characters[get(selectedCharID)]
            const chat = selchar.chats[selchar.chatPage]
            let lastChat = chat.fmIndex === -1 ? selchar.firstMessage : selchar.alternateGreetings[chat.fmIndex]
            let pointer = chatID - 1
            while (pointer >= 0) {
              if (chat.message[pointer].role === chat.message[chatID].role) {
                lastChat = chat.message[pointer].data
                break
              }
              pointer--
            }

            const r = lastChat.match(reg)
            if (!v) {
              data = data + r[0]
            } else if (r[0]) {
              switch (v) {
                case 'end':
                  data = data + r[0]
                  break
                case 'start':
                  data = r[0] + data
                  break
                case 'end_nl':
                  data = data + '\n' + r[0]
                  break
                case 'start_nl':
                  data = r[0] + '\n' + data
                  break
              }
            }
          }
        }
      } else {
        data = risuChatParser(data.replace(reg, outScript), { chatID: chatID, cbsConditions })
      }
    }
  }

  let parsedScripts: pScript[] = []
  let orderChanged = false
  for (const script of scripts) {
    if (script.ableFlag && script.flag?.includes('<')) {
      const rregex = /<(.+?)>/g
      const scriptData = safeStructuredClone(script)
      let order = 0
      const actions: string[] = []
      scriptData.flag = scriptData.flag?.replace(rregex, (v: string, p1: string) => {
        const meta = p1.split(',').map((v) => v.trim())
        for (const m of meta) {
          if (m.startsWith('order ')) {
            order = parseInt(m.substring(6))
            orderChanged = true
          } else {
            actions.push(m)
          }
        }

        return ''
      })
      parsedScripts.push({
        script: scriptData,
        order,
        actions,
      })
      continue
    }
    parsedScripts.push({
      script,
      order: 0,
      actions: [],
    })
  }

  if (orderChanged) {
    parsedScripts.sort((a, b) => b.order - a.order) //sort by order
  }
  for (const script of parsedScripts) {
    try {
      executeScript(script)
    } catch (error) {
      console.error(error)
    }
  }

  if (
    db.dynamicAssets &&
    (char.type === 'simple' || char.type === 'character') &&
    char.additionalAssets &&
    char.additionalAssets.length > 0
  ) {
    if ((!db.dynamicAssetsEditDisplay && mode === 'editdisplay') || mode === 'editinput' || mode === 'editprocess') {
      cacheScript(hash, data)
      return { data, emoChanged }
    }
    const assetNames = char.additionalAssets.map((v) => v[0])

    const moduleAssets = getModuleAssets()
    if (moduleAssets.length > 0) {
      for (const asset of moduleAssets) {
        assetNames.push(asset[0])
      }
    }

    const processer = new HypaProcesser()
    await processer.addText(assetNames)
    const matches = data.matchAll(assetRegex)

    for (const match of matches) {
      const type = match[1]
      const assetName = match[2]
      const cacheKey = char.chaId + '::' + assetName
      if (type !== 'emotion' && type !== 'source') {
        const cachedBestMatch = getBestMatch(cacheKey)
        if (cachedBestMatch !== undefined) {
          data = data.replaceAll(match[0], `{{${type}::${cachedBestMatch}}}`)
        } else if (!assetNames.includes(assetName)) {
          const searched = await processer.similaritySearch(assetName)
          const bestMatch = searched[0]
          if (bestMatch) {
            data = data.replaceAll(match[0], `{{${type}::${bestMatch}}}`)
            cacheBestMatch(cacheKey, bestMatch)
          }
        }
      }
    }
  }

  cacheScript(hash, data)

  return { data, emoChanged }
}

const rgx = /(?:{{|<)(.+?)(?:}}|>)/gm
export const risuChatParser = risuChatParserOrg
