import { language } from 'src/lang'
import { alertClear, alertConfirm, alertError, alertModuleSelect, alertNormal, alertStore, alertWait } from '../alert'
import {
  getCurrentCharacter,
  getCurrentChat,
  getDatabase,
  setDatabase,
  type customscript,
  type loreBook,
  type triggerscript,
} from '../storage/database.svelte'
import { AppendableBuffer, downloadFile, forageStorage, readImage, saveAssets } from '../globalApi.svelte'
import { selectSingleFile, sleep } from '../util'
import { v4 } from 'uuid'
import { convertExternalLorebook } from './lorebook.svelte'
import { compressImage } from '../media'
import { decodeRPack, encodeRPack } from '../rpack/rpack_js'
import { DBState, HideIconStore, moduleBackgroundEmbedding, reloadGuiAfterDefinitionChange } from '../stores.svelte'
import { createGlobalModule } from '../moduleCommands'
import {
  currentLorebookCollectionScopedSnapshot,
  dispatchReplaceCharacterLorebooks,
  ensureClientLorebookEntryIds,
  isCharacterLorebookHydrated,
  rollbackCharacterLorebookReplacement,
} from '../server/lorebookBridge.svelte'
import {
  dispatchReplaceCharacterScripts,
  dispatchReplaceCharacterTriggers,
  ensureClientScriptDefinitionIds,
  ensureClientTriggerDefinitionIds,
  rollbackScopedScriptDefinitionReplacement,
} from '../server/scriptDefinitionBridge.svelte'
import { withTrustedServerProjectionWrite } from '../server/projectionWriteGuard.svelte'
import { runOptimisticCommandSequence } from '../chatCommands'
import {
  replaceCharacterLorebooksCommand,
  replaceCharacterScriptsCommand,
  replaceCharacterTriggersCommand,
  type ServerCommandResult,
} from '../server/commands'

export interface MCPModule {
  url: string
}

export interface RisuModule {
  name: string
  description: string
  lorebook?: loreBook[]
  regex?: customscript[]
  cjs?: string
  trigger?: triggerscript[]
  id: string
  lowLevelAccess?: boolean
  hideIcon?: boolean
  backgroundEmbedding?: string
  assets?: [string, string, string][]
  namespace?: string
  customModuleToggle?: string
  mcp?: MCPModule
}

const MCP_MODULE_IMPORT_UNSUPPORTED = 'MCP module import is not supported in Fastify server-backed mode yet'

export interface ReadModuleOptions {
  beforeSaveAssets?: (module: RisuModule) => boolean | void | Promise<boolean | void>
}

interface ImportRisuModuleOptions {
  alertSuccess?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeModuleAssetMetadata(value: unknown): [string, string, string][] | null | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (!Array.isArray(value)) {
    return null
  }
  const assets: [string, string, string][] = []
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) {
      return null
    }
    if (typeof entry[0] !== 'string' || typeof entry[1] !== 'string') {
      return null
    }
    const fileName = entry[2]
    if (fileName !== undefined && fileName !== null && typeof fileName !== 'string') {
      return null
    }
    assets.push([entry[0], entry[1], fileName ?? ''])
  }
  return assets
}

function normalizeRisuModuleMetadata(module: unknown): RisuModule | null {
  if (!isRecord(module)) {
    return null
  }
  if (typeof module.name !== 'string' || module.name.trim() === '') {
    return null
  }
  if (typeof module.id !== 'string' || module.id.trim() === '') {
    return null
  }
  const assets = normalizeModuleAssetMetadata(module.assets)
  if (assets === null) {
    return null
  }
  const normalized = module as unknown as RisuModule
  if (assets) {
    normalized.assets = assets
  } else {
    delete normalized.assets
  }
  return normalized
}

function hasMcpModuleMetadata(module: RisuModule): boolean {
  return Object.prototype.hasOwnProperty.call(module, 'mcp')
}

async function guardImportableRisuModule(module: RisuModule): Promise<boolean> {
  if (hasMcpModuleMetadata(module)) {
    alertError(MCP_MODULE_IMPORT_UNSUPPORTED)
    return false
  }
  if (module.lowLevelAccess) {
    const conf = await alertConfirm(language.lowLevelAccessConfirm)
    if (!conf) {
      return false
    }
  }
  return true
}

export async function exportModule(
  module: RisuModule,
  arg: {
    alertEnd?: boolean
    saveData?: boolean
  } = {},
) {
  const alertEnd = arg.alertEnd ?? true
  const saveData = arg.saveData ?? true
  const apb = new AppendableBuffer()
  const writeLength = (len: number) => {
    const lenbuf = Buffer.alloc(4)
    lenbuf.writeUInt32LE(len, 0)
    apb.append(lenbuf)
  }
  const writeByte = (byte: number) => {
    //byte is 0-255
    const buf = Buffer.alloc(1)
    buf.writeUInt8(byte, 0)
    apb.append(buf)
  }

  const assets = module.assets ?? []
  module = safeStructuredClone(module)
  module.assets ??= []
  module.assets = module.assets.map((asset) => {
    return [asset[0], '', asset[2]] as [string, string, string]
  })

  const mainbuf = await encodeRPack(
    Buffer.from(
      JSON.stringify(
        {
          module: module,
          type: 'risuModule',
        },
        null,
        2,
      ),
      'utf-8',
    ),
  )

  writeByte(111) //magic number
  writeByte(0) //version
  writeLength(mainbuf.length)
  apb.append(mainbuf)

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i]
    writeByte(1) //mark as asset
    alertStore.set({
      type: 'wait',
      msg: `Loading... (Adding Assets ${i} / ${assets.length})`,
    })
    let rData = await readImage(asset[1])
    if (!rData) {
      rData = new Uint8Array(0) //blank buffer
    }
    let encoded = await encodeRPack(Buffer.from(await compressImage(rData)))
    writeLength(encoded.length)
    apb.append(encoded)
  }

  writeByte(0) //end of file

  if (saveData) {
    await downloadFile(module.name + '.risum', apb.buffer)
  }
  if (alertEnd) {
    alertNormal(language.successExport)
  }

  return apb.buffer
}

export async function readModule(
  data: Uint8Array | Buffer,
  options: ReadModuleOptions = {},
): Promise<RisuModule | undefined> {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  let pos = 0

  const readLength = () => {
    if (pos + 4 > buf.length) {
      throw new Error('Unexpected end of module file')
    }
    const len = buf.readUInt32LE(pos)
    pos += 4
    return len
  }
  const readByte = () => {
    if (pos + 1 > buf.length) {
      throw new Error('Unexpected end of module file')
    }
    const byte = buf.readUInt8(pos)
    pos += 1
    return byte
  }
  const readData = (len: number) => {
    if (len < 0 || pos + len > buf.length) {
      throw new Error('Unexpected end of module file')
    }
    const data = buf.subarray(pos, pos + len)
    pos += len
    return data
  }

  try {
    if (readByte() !== 111) {
      throw new Error('Invalid magic number')
    }
    if (readByte() !== 0) {
      //Version check
      throw new Error('Invalid version')
    }

    const mainLen = readLength()
    const mainData = readData(mainLen)
    const main: {
      type?: unknown
      module?: unknown
    } = JSON.parse(Buffer.from(await decodeRPack(mainData)).toString())

    const parsedModule = normalizeRisuModuleMetadata(main.module)
    if (main.type !== 'risuModule' || !parsedModule) {
      throw new Error('Invalid module data')
    }

    let module = parsedModule

    const shouldReadAssets = await options.beforeSaveAssets?.(module)
    if (shouldReadAssets === false) {
      return
    }

    const retryDelayMs = 5000
    const maxRetries = 3
    const totalAssets = module.assets?.length ?? 0
    let completed = 0

    type AssetTask = {
      index: number
      data: Uint8Array
    }

    const runAssetTasks = async (tasks: AssetTask[]) => {
      if (tasks.length === 0) {
        return []
      }
      const failed: AssetTask[] = []
      const decodedTasks: { task: AssetTask; decoded: Uint8Array; fileName: string }[] = []
      for (const task of tasks) {
        try {
          const decoded = await decodeRPack(task.data)
          if (!module.assets?.[task.index]) {
            throw new Error(`Missing asset metadata for index ${task.index}`)
          }
          decodedTasks.push({
            task,
            decoded,
            fileName: module.assets[task.index][2] ?? '',
          })
        } catch (error) {
          failed.push(task)
        }
        alertWait(`Loading... (Adding Assets ${completed} / ${totalAssets})`)
      }

      try {
        const savedAssetIds = await saveAssets(
          decodedTasks.map((task) => ({
            data: task.decoded,
            fileName: task.fileName,
          })),
        )
        for (let i = 0; i < decodedTasks.length; i++) {
          // Preserve the module asset's declared filename (the [2] slot of
          // the [name, asset_id, filename] tuple) so persisted metadata
          // matches the source extension.
          module.assets[decodedTasks[i].task.index][1] = savedAssetIds[i]
          completed += 1
        }
      } catch (error) {
        failed.push(...decodedTasks.map((task) => task.task))
      }
      alertWait(`Loading... (Adding Assets ${completed} / ${totalAssets})`)
      return failed
    }

    const tasks: AssetTask[] = []
    let i = 0
    while (true) {
      const mark = readByte()
      if (mark === 0) {
        break
      }
      if (mark !== 1) {
        throw new Error('Invalid module asset marker')
      }
      const len = readLength()
      const data = readData(len)
      tasks.push({
        index: i,
        data,
      })
      i++
    }

    if (tasks.length !== totalAssets) {
      throw new Error('Module asset payload count does not match metadata')
    }

    try {
      let failed = await runAssetTasks(tasks)
      let retryCount = 0
      while (failed.length > 0 && retryCount < maxRetries) {
        await sleep(retryDelayMs)
        retryCount += 1
        failed = await runAssetTasks(failed)
      }
      if (failed.length > 0) {
        throw new Error(`Failed to save ${failed.length} assets`)
      }
    } finally {
      alertClear()
    }

    module.id = v4()
    return module
  } catch (error) {
    console.error(error)
    alertError(language.errors.noData)
    return
  }
}

export async function importRisuModuleData(
  data: Uint8Array | Buffer,
  options: ImportRisuModuleOptions = {},
): Promise<RisuModule | undefined> {
  const alertSuccess = options.alertSuccess ?? true
  const module = await readModule(data, {
    beforeSaveAssets: guardImportableRisuModule,
  })
  if (!module) {
    return
  }
  createGlobalModule(module)
  if (alertSuccess) {
    alertNormal(language.successImport)
  }
  return module
}

export async function importRisuModuleObject(
  importData: RisuModule,
  options: ImportRisuModuleOptions = {},
): Promise<RisuModule | false | undefined> {
  const alertSuccess = options.alertSuccess ?? false
  const normalizedImportData = normalizeRisuModuleMetadata(importData)
  if (!normalizedImportData) {
    alertError(language.errors.noData)
    return
  }
  if (!(await guardImportableRisuModule(normalizedImportData))) {
    return false
  }
  normalizedImportData.id = v4()
  createGlobalModule(normalizedImportData)
  if (alertSuccess) {
    alertNormal(language.successImport)
  }
  return normalizedImportData
}

export async function importModule() {
  const f = await selectSingleFile(['json', 'lorebook', 'risum'])
  if (!f) {
    return
  }
  let fileData = f.data
  if (f.name.endsWith('.risum')) {
    await importRisuModuleData(fileData)
    return
  }
  try {
    const importData = JSON.parse(Buffer.from(fileData).toString())
    if (importData.type === 'risuModule') {
      await importRisuModuleObject(importData)
      return
    }
    // importData.type === 'risu' in conflict with HypaV3 preset exports
    // difference: record vs. array
    if (importData.type === 'risu' && importData.data && Array.isArray(importData.data)) {
      const lores: loreBook[] = importData.data
      const importModule = {
        name: importData.name || 'Imported Lorebook',
        description: importData.description || 'Converted from risu lorebook',
        lorebook: lores,
        id: v4(),
      }
      createGlobalModule(importModule)
      return
    }
    if (importData.entries) {
      const lores: loreBook[] = convertExternalLorebook(importData.entries)
      const importModule = {
        name: importData.name || 'Imported Lorebook',
        description: importData.description || 'Converted from external lorebook',
        lorebook: lores,
        id: v4(),
      }
      createGlobalModule(importModule)
      return
    }
    if (importData.type === 'regex' && importData.data) {
      const regexs: customscript[] = importData.data
      const importModule = {
        name: importData.name || 'Imported Regex',
        description: importData.description || 'Converted from risu regex',
        regex: regexs,
        id: v4(),
      }
      createGlobalModule(importModule)
      return
    }
  } catch (error) {
    console.error(error)
  }

  alertNormal(language.errors.noData)
}

const emptyModuleList: RisuModule[] = []

function getDatabaseModules(db: ReturnType<typeof getDatabase> = getDatabase()) {
  return Array.isArray(db.modules) ? db.modules : emptyModuleList
}

function getModuleById(id: string) {
  const modules = getDatabaseModules()
  for (let i = 0; i < modules.length; i++) {
    if (modules[i].id === id) {
      return modules[i]
    }
  }
  return null
}

function getModuleByIds(ids: string[]) {
  const idSet = new Set(ids)
  const modules = getDatabaseModules().filter((m) => idSet.has(m.id) || (m.namespace && idSet.has(m.namespace)))
  return deduplicateModuleById(modules)
}

function deduplicateModuleById(modules: RisuModule[]) {
  let ids: string[] = []
  let newModules: RisuModule[] = []
  for (let i = 0; i < modules.length; i++) {
    if (ids.includes(modules[i].id)) {
      continue
    }
    ids.push(modules[i].id)
    newModules.push(modules[i])
  }
  return newModules
}

type PromptPresetModuleIntegration = {
  id?: unknown
  moduleIntergration?: unknown
}

function promptPresetModuleIntegration(
  db: ReturnType<typeof getDatabase>,
  currentChat: ReturnType<typeof getCurrentChat>,
) {
  const promptPresetId = currentChat?.generationSettings?.promptPresetId
  if (typeof promptPresetId === 'string' && promptPresetId.trim().length > 0) {
    const promptPresets = Array.isArray(db.promptPresets) ? (db.promptPresets as PromptPresetModuleIntegration[]) : []
    const preset = promptPresets.find((candidate) => candidate?.id === promptPresetId)
    return typeof preset?.moduleIntergration === 'string' ? preset.moduleIntergration : ''
  }
  return typeof db.moduleIntergration === 'string' ? db.moduleIntergration : ''
}

function parseModuleIntegration(value: string) {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

let lastModules = ''
let lastModuleData: RisuModule[] = []
let lastModuleSource: RisuModule[] | undefined

function activeModuleCacheRowsStillPresent(moduleSource: RisuModule[]): boolean {
  if (lastModuleData.length === 0) return true

  const sourceRows = new Set(moduleSource)
  return lastModuleData.every((module) => sourceRows.has(module))
}

export function getModules() {
  const currentChat = getCurrentChat()
  const character = getCurrentCharacter()
  const db = getDatabase()
  const moduleSource = getDatabaseModules(db)
  let ids = db.enabledModules ?? []
  if (currentChat) {
    ids = ids.concat(currentChat.modules ?? [])
  }
  if (character && character.modules) {
    ids = ids.concat(character.modules)
  }
  const moduleIntergration = promptPresetModuleIntegration(db, currentChat)
  if (moduleIntergration) {
    ids = ids.concat(parseModuleIntegration(moduleIntergration))
  }
  const idsJoined = JSON.stringify(ids)
  if (
    lastModules === idsJoined &&
    lastModuleSource === moduleSource &&
    activeModuleCacheRowsStillPresent(moduleSource)
  ) {
    return lastModuleData
  }

  let modules: RisuModule[] = getModuleByIds(ids)
  lastModules = idsJoined
  lastModuleSource = moduleSource
  lastModuleData = modules
  return modules
}

export function getModuleLorebooks() {
  const modules = getModules()
  let lorebooks: loreBook[] = []
  for (const module of modules) {
    if (!module) {
      continue
    }
    if (module.lorebook) {
      lorebooks = lorebooks.concat(module.lorebook)
    }
  }
  return lorebooks
}

export function getModuleAssets() {
  const modules = getModules()
  let assets: [string, string, string][] = []
  for (const module of modules) {
    if (!module) {
      continue
    }
    if (module.assets) {
      assets = assets.concat(module.assets)
    }
  }
  return assets
}

export function getModuleTriggers() {
  const modules = getModules()
  let triggers: triggerscript[] = []
  for (const module of modules) {
    if (!module) {
      continue
    }
    if (module.trigger) {
      triggers = triggers.concat(
        module.trigger.map((t) => {
          return {
            ...t,
            lowLevelAccess: module.lowLevelAccess,
          }
        }),
      )
    }
  }
  return triggers
}

export function getModuleRegexScripts() {
  const modules = getModules()
  let customscripts: customscript[] = []
  for (const module of modules) {
    if (!module) {
      continue
    }
    if (module.regex) {
      customscripts = customscripts.concat(module.regex)
    }
  }
  return customscripts
}

export function getModuleToggles() {
  const modules = getModules()
  let costomModuleToggles: string = ''
  for (const module of modules) {
    if (!module) {
      continue
    }
    if (module.customModuleToggle) {
      costomModuleToggles += '\n' + module.customModuleToggle + '\n'
    }
  }
  return costomModuleToggles
}

export function getModuleMcps() {
  const modules = getModules()

  return modules.map((v) => v.mcp?.url).filter((v) => v)
}

type ModuleApplyCommandFactory = (baseRevision: number) => Promise<ServerCommandResult>

interface ModuleApplyStep {
  succeeded: boolean
  command: ModuleApplyCommandFactory
  rollback: () => void
}

function createModuleApplyStep(command: ModuleApplyCommandFactory, rollback: () => void): ModuleApplyStep {
  const step: ModuleApplyStep = {
    succeeded: false,
    command: async (baseRevision) => {
      const result = await command(baseRevision)
      if (result.status === 'ok') {
        step.succeeded = true
      }
      return result
    },
    rollback,
  }
  return step
}

function rollbackUnacceptedModuleApplySteps(steps: ModuleApplyStep[]): void {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]
    if (!step.succeeded) {
      step.rollback()
    }
  }
}

export async function applyModule() {
  const sel = await alertModuleSelect()
  if (!sel) {
    return
  }

  const module = safeStructuredClone(getModuleById(sel))
  if (!module) {
    return
  }

  const currentChar = getCurrentCharacter()
  if (!currentChar) {
    return
  }

  const characterId = currentChar.chaId
  if (!characterId) {
    return
  }

  const canApplyLorebooks =
    !!module.lorebook && (!DBState.db?.enableLorebookStubs || isCharacterLorebookHydrated(characterId))
  const lorePrevious = canApplyLorebooks
    ? currentLorebookCollectionScopedSnapshot({ kind: 'character', characterId })
    : null
  const previousScripts = module.regex ? safeStructuredClone(currentChar.customscript ?? []) : null
  const previousTriggers = module.trigger ? safeStructuredClone(currentChar.triggerscript ?? []) : null
  const hadScriptsField = module.regex ? Object.prototype.hasOwnProperty.call(currentChar, 'customscript') : false
  const hadTriggersField = module.trigger ? Object.prototype.hasOwnProperty.call(currentChar, 'triggerscript') : false

  const nextLorebooks =
    module.lorebook && lorePrevious
      ? ensureClientLorebookEntryIds([...(currentChar.globalLore ?? []), ...safeStructuredClone(module.lorebook)])
      : undefined
  const nextScripts = module.regex
    ? ensureClientScriptDefinitionIds([...(currentChar.customscript ?? []), ...safeStructuredClone(module.regex)])
    : undefined
  const nextTriggers = module.trigger
    ? ensureClientTriggerDefinitionIds([...(currentChar.triggerscript ?? []), ...safeStructuredClone(module.trigger)])
    : undefined

  withTrustedServerProjectionWrite(() => {
    const target = DBState.db.characters.find((character) => character.chaId === characterId)
    if (!target) return
    if (nextLorebooks) target.globalLore = safeStructuredClone(nextLorebooks)
    if (nextScripts) target.customscript = safeStructuredClone(nextScripts)
    if (nextTriggers) target.triggerscript = safeStructuredClone(nextTriggers)
  })

  // Serialize the three module-apply replacements. Each optimistic step owns a
  // scoped rollback record, and the sequencer awaits each response so the next
  // command reads the updated cached revision.
  if (characterId) {
    const steps: ModuleApplyStep[] = []
    if (nextLorebooks && lorePrevious) {
      const lorebookSnapshot = safeStructuredClone(nextLorebooks) as Parameters<
        typeof replaceCharacterLorebooksCommand
      >[0]['entries']
      const attemptedLorebooks = safeStructuredClone(lorebookSnapshot) as loreBook[]
      steps.push(
        createModuleApplyStep(
          (baseRevision) =>
            replaceCharacterLorebooksCommand({
              baseRevision,
              characterId,
              entries: lorebookSnapshot,
            }),
          () => rollbackCharacterLorebookReplacement(characterId, lorePrevious, attemptedLorebooks),
        ),
      )
    }
    if (nextScripts && previousScripts) {
      const scriptsSnapshot = safeStructuredClone(nextScripts) as Parameters<
        typeof replaceCharacterScriptsCommand
      >[0]['scripts']
      const attemptedScripts = safeStructuredClone(scriptsSnapshot) as customscript[]
      steps.push(
        createModuleApplyStep(
          (baseRevision) =>
            replaceCharacterScriptsCommand({
              baseRevision,
              characterId,
              scripts: scriptsSnapshot,
            }),
          () =>
            rollbackScopedScriptDefinitionReplacement(
              {
                kind: 'characterScripts',
                characterId,
                scripts: previousScripts,
                hadScriptsField,
              },
              {
                kind: 'characterScripts',
                characterId,
                scripts: attemptedScripts,
              },
            ),
        ),
      )
    }
    if (nextTriggers && previousTriggers) {
      const triggersSnapshot = safeStructuredClone(nextTriggers) as Parameters<
        typeof replaceCharacterTriggersCommand
      >[0]['triggers']
      const attemptedTriggers = safeStructuredClone(triggersSnapshot) as triggerscript[]
      steps.push(
        createModuleApplyStep(
          (baseRevision) =>
            replaceCharacterTriggersCommand({
              baseRevision,
              characterId,
              triggers: triggersSnapshot,
            }),
          () =>
            rollbackScopedScriptDefinitionReplacement(
              {
                kind: 'characterTriggers',
                characterId,
                triggers: previousTriggers,
                hadTriggersField,
              },
              {
                kind: 'characterTriggers',
                characterId,
                triggers: attemptedTriggers,
              },
            ),
        ),
      )
    }
    if (steps.length > 0) {
      runOptimisticCommandSequence(
        steps.map((step) => step.command) as Parameters<typeof runOptimisticCommandSequence>[0],
        () => rollbackUnacceptedModuleApplySteps(steps),
      )
    }
  }
  // Keep the bridge dispatchers imported so delay-based coalescing can use
  // them without re-importing. Reference
  // them via void to satisfy the linter without dispatching.
  void dispatchReplaceCharacterLorebooks
  void dispatchReplaceCharacterScripts
  void dispatchReplaceCharacterTriggers

  alertNormal(language.successApplyModule)
}

let lastModuleIds: string = ''

export function moduleUpdate() {
  const m = getModules()

  const ids = m.map((m) => m.id).join('-')

  let moduleHideIcon = false
  let backgroundEmbedding = ''
  m.forEach((module) => {
    if (!module) {
      return
    }

    if (module.hideIcon) {
      moduleHideIcon = true
    }
    if (module.backgroundEmbedding) {
      backgroundEmbedding += '\n' + module.backgroundEmbedding + '\n'
    }
  })

  moduleBackgroundEmbedding.set(backgroundEmbedding)
  HideIconStore.set(getCurrentCharacter()?.hideChatIcon || moduleHideIcon)

  if (lastModuleIds !== ids) {
    reloadGuiAfterDefinitionChange()
    lastModuleIds = ids
  }
}

export function refreshModules() {
  lastModules = ''
  lastModuleData = []
  lastModuleSource = undefined
}
