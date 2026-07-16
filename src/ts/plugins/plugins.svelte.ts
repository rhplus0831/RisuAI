import { get, writable } from 'svelte/store'
import { language } from '../../lang'
import { getCurrentCharacter, getDatabase, setDatabase, setDatabaseLite } from '../storage/database.svelte'
import { alertConfirm, alertError, alertPluginConfirm } from '../alert'
import { selectSingleFile, sleep } from '../util'
import type { OpenAIChat } from '../process/index.svelte'
import { pluginFetchNative, pluginGlobalFetch, readImage, saveAsset } from '../globalApi.svelte'
import { hotReloading, pluginAlertModalStore, selectedCharID } from '../stores.svelte'
import type { ScriptMode } from '../process/scripts'
import type { RisuModule } from '../process/modules'
import { safeStructuredClone } from '../polyfill'
import { checkCodeSafety } from './pluginSafety'
import {
  BlockedPluginNetworkPrimitive,
  SafeDocument,
  SafeIdbFactory,
  SafeLocalStorage,
  SafePluginLocation,
  SafePluginNavigator,
  isDeviceLocalPluginStorageEnabled,
} from './pluginSafeClass'
import { loadV3Plugins } from './apiV3/v3.svelte'
import { pluginCodeTranspiler } from './apiV3/transpiler'
import {
  acceptedPluginRuntimeProjection,
  currentPluginStorageSnapshot,
  currentPluginStateSnapshot,
  currentPluginSettingsPatchRollbackSnapshot,
  dispatchBulkPluginStorage,
  dispatchPluginCollectionPatch,
  dispatchDeletePluginStorage,
  dispatchPluginSettingsPatch,
  dispatchPutPluginStorage,
  dispatchSelectPluginProvider,
  dispatchUpdatePlugin,
  runCreatePluginCommand,
  runUpdatePluginCommand,
  toPluginSnapshot,
} from '../pluginCommands'
import {
  currentGlobalModuleStateSnapshot,
  dispatchEnabledModulesPatch,
  dispatchModuleCollectionPatch,
} from '../moduleCommands'
import { currentCharacterRowSnapshot, prepareCompatibleCharacterUpdateScoped } from '../characterCommands'
import { canUseServerCommands } from '../server/commands'
import { withTrustedResourceWrite } from '../server/resourceWriteGuard.svelte'
import { assertNoUnsupportedCharacterChanges } from './unsupportedServerWriteGuard'
import {
  beginPluginImport,
  capturePluginImportTarget,
  clearPluginImport,
  isFreshPluginImport,
  resolveFreshPluginImportApplyTarget,
  type PluginImportFreshness,
  type PluginImportOperation,
} from '../server/pluginImport'
import { createPluginNetworkAccess, createPluginWebFetch } from './pluginNetworkAccess'
import { getPluginPermission } from './pluginPermissions'
import {
  checkPluginUpdate as checkPluginUpdateRequest,
  comparePluginVersions,
  downloadPluginUpdate,
} from './pluginUpdates'

export const customProviderStore = writable([] as string[])

interface ProviderPlugin {
  name: string
  displayName?: string
  script: string
  arguments: { [key: string]: 'int' | 'string' | string[] }
  realArg: { [key: string]: number | string }
  version?: 1 | 2 | '2.1' | '3.0'
  customLink: ProviderPluginCustomLink[]
  argMeta: { [key: string]: { [key: string]: string } }
  versionOfPlugin?: string
  updateURL?: string
  enabled?: boolean
  allowedIPC?: string[]
}
interface ProviderPluginCustomLink {
  link: string
  hoverText?: string
}

export type RisuPlugin = ProviderPlugin

export async function createBlankPlugin() {
  await importPlugin(
    `
//@name New Plugin
//@display-name New Plugin Display Name
//@api 3.0
//@arg example_arg string

Risuai.log("Hello from New Plugin!");
`.trim(),
  )
}

function currentPluginImportFreshness(): PluginImportFreshness<RisuPlugin> {
  return {
    plugins: getDatabase().plugins ?? [],
  }
}

function isCurrentPluginUpdateTarget(plugin: Pick<RisuPlugin, 'name' | 'script' | 'updateURL'>): boolean {
  const current = (getDatabase().plugins ?? []).find((candidate) => candidate.name === plugin.name)
  return current?.script === plugin.script && current.updateURL === plugin.updateURL
}

export async function checkPluginUpdate(plugin: RisuPlugin) {
  const target = { ...plugin }
  return checkPluginUpdateRequest(target, () => isCurrentPluginUpdateTarget(target))
}

export type PluginUpdateInstallResult = 'installed' | 'denied' | 'failed' | 'stale'

export async function installPluginUpdate(plugin: RisuPlugin): Promise<PluginUpdateInstallResult> {
  let operation: PluginImportOperation | null = null
  try {
    if (!plugin.updateURL) {
      return 'failed'
    }

    operation = beginPluginImport(capturePluginImportTarget(currentPluginImportFreshness()))
    const download = await downloadPluginUpdate(plugin, () => isCurrentPluginUpdateTarget(plugin))
    if (download.status !== 'downloaded') return download.status
    if (!isFreshPluginImport(operation, currentPluginImportFreshness()) || !isCurrentPluginUpdateTarget(plugin)) {
      return 'stale'
    }
    const imported = await importPlugin(download.source, {
      isUpdate: true,
      originalPluginName: plugin.name,
      operation,
    })
    if (imported) return 'installed'
    if (!isFreshPluginImport(operation, currentPluginImportFreshness())) {
      return 'stale'
    }
    return 'failed'
  } catch (error) {
    if (!operation || isFreshPluginImport(operation, currentPluginImportFreshness())) {
      console.error('Failed to update plugin:', error)
    }
  } finally {
    if (operation) {
      clearPluginImport(operation)
    }
  }
  return 'failed'
}

export async function updatePlugin(plugin: RisuPlugin): Promise<boolean> {
  return (await installPluginUpdate(plugin)) === 'installed'
}

export async function importPlugin(
  code: string | null = null,
  argu: {
    isUpdate?: boolean
    originalPluginName?: string
    isHotReload?: boolean
    isTypescript?: boolean
    operation?: PluginImportOperation
  } = {},
): Promise<boolean> {
  let operation: PluginImportOperation | null = argu.operation ?? null
  let releasePluginRuntimeSync: (() => void) | null = null
  const beginImport = () => {
    operation ??= beginPluginImport(capturePluginImportTarget(currentPluginImportFreshness()))
  }
  const isFreshImport = () => operation !== null && isFreshPluginImport(operation, currentPluginImportFreshness())

  try {
    let jsFile = ''
    let isUpdate = argu.isUpdate || false
    let originalPluginName = argu.originalPluginName || ''
    let isTypescript = argu.isTypescript || false

    if (!code) {
      const f = await selectSingleFile(['js', 'ts'], { onFileSelected: beginImport })
      if (!f) {
        return false
      }
      beginImport()
      if (!isFreshImport()) {
        return false
      }
      if (f.name.endsWith('.ts')) {
        isTypescript = true
      }
      //support utf-8 with BOM or without BOM
      jsFile = Buffer.from(f.data)
        .toString('utf-8')
        .replace(/^\uFEFF/gm, '')
    } else {
      beginImport()
      if (!isFreshImport()) {
        return false
      }
      jsFile = code
    }

    const splitedJs = jsFile.split('\n')
    let name = ''
    for (const line of splitedJs) {
      if (line.startsWith('//@name')) {
        name = line.slice(7).trim()
        break
      }
    }

    const showError = (msg: string): false => {
      if (isFreshImport()) {
        if (argu.isHotReload) {
          console.error(`Hot-reload plugin "${name}" error: ${msg}`)
        } else {
          alertError(msg)
        }
      }
      return false
    }

    let displayName: string = undefined
    let arg: { [key: string]: 'int' | 'string' | string[] } = {}
    let realArg: { [key: string]: number | string } = {}
    let argMeta: { [key: string]: { [key: string]: string } } = {}
    let customLink: ProviderPluginCustomLink[] = []
    let updateURL: string = ''
    let versionOfPlugin: string = '' //This is the version of the plugin itself, not the API version
    let apiVersion = '2.0'
    let ipcList: string[] = []
    for (const line of splitedJs) {
      if (line.startsWith('//@name')) {
        const provied = line.slice(7)
        if (provied === '') {
          return showError('plugin name must be longer than 0, did you put it correctly?')
        }
        name = provied.trim()
      }
      if (line.startsWith('//@api')) {
        const proviedVersions = line.slice(6).trim().split(' ')
        const supportedVersions = ['2.0', '2.1', '3.0']
        for (const ver of proviedVersions) {
          if (supportedVersions.includes(ver)) {
            apiVersion = ver
            break
          } else {
            console.warn(`Plugin API version "${ver}" is not supported.`)
          }
        }
      }
      if (line.startsWith('//@display-name')) {
        const provied = line.slice('//@display-name'.length + 1)
        if (provied === '') {
          return showError('plugin display name must be longer than 0, did you put it correctly?')
        }
        displayName = provied.trim()
      }

      if (line.startsWith('//@link')) {
        const link = line.split(' ')[1]
        if (!link || link === '') {
          return showError('plugin link is empty, did you put it correctly?')
        }
        if (!link.startsWith('https')) {
          return showError('plugin link must start with https, did you check it?')
        }
        const hoverText = line.split(' ').slice(2).join(' ').trim()
        if (hoverText === '') {
          // OK, no hover text. It's fine.
          customLink.push({
            link: link,
            hoverText: undefined,
          })
        } else
          customLink.push({
            link: link,
            hoverText: hoverText || undefined,
          })
      }
      if (line.startsWith('//@risu-arg') || line.startsWith('//@arg')) {
        const provied = line.trim().split(' ')
        if (provied.length < 3) {
          return showError('plugin argument is incorrect, did you put space in argument name?')
        }
        const provKey = provied[1]

        if (provied[2] !== 'int' && provied[2] !== 'string') {
          return showError(`plugin argument type is "${provied[2]}", which is an unknown type.`)
        }
        if (provied[2] === 'int') {
          arg[provKey] = 'int'
          realArg[provKey] = 0
        } else if (provied[2] === 'string') {
          arg[provKey] = 'string'
          realArg[provKey] = ''
        }

        if (provied.length > 3) {
          const meta: { [key: string]: string } = {}
          //Compatibility layer for unofficial meta
          let metaStr = provied
            .slice(3)
            .join(' ')
            .replace(/{{(.+?)(::?(.+?))?}}/g, (a, g1: string, g2, g3: string) => {
              console.log(g1, g3)
              meta[g1] = g3 || '1'
              return ''
            })
            .trim()

          if (metaStr) {
            meta['description'] = metaStr
          }

          argMeta[provKey] = meta
        }
      }

      if (line.startsWith('//@update-url')) {
        updateURL = line.split(' ')[1]

        try {
          const url = new URL(updateURL)
          if (url.protocol !== 'https:') {
            return showError('plugin update URL must start with https, did you put it correctly?')
          }
        } catch (error) {
          return showError('plugin update URL is not a valid URL, did you put it correctly?')
        }
      }

      if (line.startsWith('//@version')) {
        versionOfPlugin = line.split(' ').slice(1).join(' ').trim()

        const versionLocation = jsFile.indexOf('//@version')
        const numberOfBytesBefore = new TextEncoder().encode(jsFile.slice(0, versionLocation) + line).length
        if (numberOfBytesBefore > 500) {
          return showError(
            'plugin version declaration must be within the first 512 Bytes of the file for proper parsing. move //@version line to the top of the file.',
          )
        }
      }

      if (line.startsWith('//@allowed-ipc')) {
        const provied = line.trim().split(' ')
        if (provied.length < 2) {
          return showError('plugin allowed IPC declaration is incorrect, did you put space after //@allowed-ipc?')
        }

        const allowedIPCList = provied.slice(1)

        ipcList.push(...allowedIPCList)
      }
    }

    if (name.length === 0) {
      return showError('plugin name not found, did you put it correctly?')
    }

    if (updateURL && versionOfPlugin.length === 0) {
      return showError(
        'plugin version not found, did you put it correctly? It is required when update URL is provided.',
      )
    }

    if (versionOfPlugin && comparePluginVersions(versionOfPlugin, '0.0.1') === -1) {
      return showError('plugin version must be at least 0.0.1')
    }

    if (isTypescript) {
      if (!isFreshImport()) {
        return false
      }
      try {
        jsFile = await pluginCodeTranspiler(jsFile)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return showError('Failed to transpile TypeScript code: ' + message)
      }
      if (!isFreshImport()) {
        return false
      }
    }

    let apiInternalVersion: 2 | '2.1' | '3.0' = '2.1'

    if (apiVersion === '2.1') {
      if (!isFreshImport()) {
        return false
      }
      const safety = await checkCodeSafety(jsFile)
      if (!isFreshImport()) {
        return false
      }
      if (!safety.isSafe) {
        pluginAlertModalStore.errors = safety.errors
        pluginAlertModalStore.open = true

        // Poll while the modal owns the user's accept/reject decision.
        while (pluginAlertModalStore.open) {
          await sleep(100)
          if (!isFreshImport()) {
            pluginAlertModalStore.open = false
            return false
          }
        }

        if (!isFreshImport()) {
          return false
        }

        if (pluginAlertModalStore.errors.length > 0) {
          return false
        }
      }
      apiInternalVersion = '2.1'
    } else if (apiVersion === '2.0') {
      //Only block installing
      return showError(
        'Your code does not include //@api or specifies API version 2.0, which is outdated. Please update your plugin to use at least API version 2.1.',
      )
    } else if (apiVersion === '3.0') {
      apiInternalVersion = '3.0'
    }

    if (apiInternalVersion !== '3.0' && argu.isHotReload) {
      return showError('Only API version 3.0 plugins can be hot-reloaded.')
    }

    let pluginData: RisuPlugin = {
      name: name,
      script: jsFile,
      realArg: realArg,
      arguments: arg,
      displayName: displayName,
      version: apiInternalVersion,
      customLink: customLink,
      argMeta: argMeta,
      versionOfPlugin: versionOfPlugin,
      updateURL: updateURL,
      allowedIPC: ipcList,
      enabled: true,
    }

    const preConfirmTarget = operation
      ? resolveFreshPluginImportApplyTarget({
          operation,
          freshness: currentPluginImportFreshness(),
          plugin: pluginData,
          isUpdate,
          originalPluginName,
          isHotReload: argu.isHotReload,
        })
      : null

    if (!preConfirmTarget) {
      return false
    }

    if (preConfirmTarget.kind === 'name-mismatch') {
      return showError(
        `When updating plugin "${preConfirmTarget.originalPluginName}", the plugin name cannot be changed to "${preConfirmTarget.pluginName}". Please keep the original name to update.`,
      )
    }

    if (!isUpdate && preConfirmTarget.kind === 'update') {
      const c = await alertConfirm(language.duplicatePluginFoundUpdateIt)
      if (!isFreshImport()) {
        return false
      }
      if (!c) {
        return false
      }
    }

    const applyTarget = operation
      ? resolveFreshPluginImportApplyTarget({
          operation,
          freshness: currentPluginImportFreshness(),
          plugin: pluginData,
          isUpdate,
          originalPluginName,
          isHotReload: argu.isHotReload,
        })
      : null

    if (!applyTarget || applyTarget.kind === 'skip') {
      return false
    }

    if (applyTarget.kind === 'name-mismatch') {
      return showError(
        `When updating plugin "${applyTarget.originalPluginName}", the plugin name cannot be changed to "${applyTarget.pluginName}". Please keep the original name to update.`,
      )
    }

    const previous = currentPluginStateSnapshot()
    // Plugin imports and updates are projected before their command settles,
    // but executing an unaccepted script would make a failed command observable
    // outside the optimistic UI. Hold automatic runtime reconciliation until
    // the accepted explicit reload below, or until rollback has restored the
    // previous runtime signature.
    releasePluginRuntimeSync = deferPluginRuntimeSync()
    let persistenceResult: ReturnType<typeof runCreatePluginCommand> | ReturnType<typeof runUpdatePluginCommand> = null
    if (applyTarget.kind === 'update') {
      // Re-read the live database inside the trusted write scope so the
      // optimistic update never mutates the read-only server projection
      // through a stale reference captured before the scope.
      withTrustedResourceWrite(() => {
        const db = getDatabase()
        db.plugins ??= []
        db.plugins[applyTarget.index] = pluginData
        setDatabaseLite(db)
      })
      persistenceResult = runUpdatePluginCommand(applyTarget.pluginId, toPluginSnapshot(pluginData), previous)
    } else if (applyTarget.kind === 'create') {
      withTrustedResourceWrite(() => {
        const db = getDatabase()
        db.plugins ??= []
        db.plugins.push(pluginData)
        setDatabaseLite(db)
      })
      persistenceResult = runCreatePluginCommand(pluginData, previous)
    }

    if (persistenceResult) {
      const result = await persistenceResult
      if (result.status !== 'accepted') {
        return false
      }
    }

    if (argu.isHotReload && !hotReloading.includes(pluginData.name)) {
      hotReloading.push(pluginData.name)
    }

    console.log(`Imported plugin: ${pluginData.name} (API v${apiVersion})`)

    loadPlugins()
    return true
  } catch (error) {
    console.error(error)
    if (!operation || isFreshPluginImport(operation, currentPluginImportFreshness())) {
      alertError(language.errors.noData)
    }
    return false
  } finally {
    releasePluginRuntimeSync?.()
    if (operation) {
      clearPluginImport(operation)
    }
  }
}

let pluginTranslator = false

export interface PluginRuntimeSignalSource {
  name: string
  enabled?: boolean
  version?: RisuPlugin['version']
  script: string
  allowedIPC?: string[]
}

/**
 * Runtime-relevant plugin identity. Argument values and presentation metadata
 * are intentionally excluded: V2/V3 getArg reads the live database, so typing
 * in a plugin setting must not tear down and execute every plugin again.
 */
export function pluginRuntimeSignature(plugins: readonly PluginRuntimeSignalSource[] | null | undefined): string {
  return JSON.stringify(
    (plugins ?? []).map((plugin) => [
      plugin.name,
      plugin.enabled === true,
      plugin.version ?? null,
      plugin.script,
      plugin.allowedIPC ?? [],
    ]),
  )
}

const pluginRuntimeSyncState = $state({
  suppressionDepth: 0,
  targetSignature: null as string | null,
})
let stopPluginRuntimeSyncEffect: (() => void) | null = null

function deferPluginRuntimeSync(): () => void {
  pluginRuntimeSyncState.suppressionDepth += 1
  let released = false
  return () => {
    if (released) return
    released = true
    pluginRuntimeSyncState.suppressionDepth = Math.max(0, pluginRuntimeSyncState.suppressionDepth - 1)
  }
}

/**
 * Keep executing plugin instances aligned with the server-backed projection.
 * The requested target (rather than only the last completed load) matters when
 * a command rolls back while the optimistic runtime reload is still in flight:
 * the rollback must queue one final load of the restored state.
 */
export function startPluginRuntimeSync(): void {
  if (stopPluginRuntimeSyncEffect) return
  pluginRuntimeSyncState.targetSignature ??= pluginRuntimeSignature(
    acceptedPluginRuntimeProjection(getDatabase().plugins ?? []),
  )
  stopPluginRuntimeSyncEffect = $effect.root(() => {
    $effect(() => {
      const signature = pluginRuntimeSignature(acceptedPluginRuntimeProjection(getDatabase().plugins ?? []))
      const suppressionDepth = pluginRuntimeSyncState.suppressionDepth
      const targetSignature = pluginRuntimeSyncState.targetSignature
      if (suppressionDepth > 0 || targetSignature === signature) return
      void loadPlugins().catch((error) => {
        console.error('Failed to reconcile plugin runtime:', error)
      })
    })
  })
}

/** Test/app-lifecycle cleanup for the root runtime synchronization effect. */
export function stopPluginRuntimeSync(): void {
  stopPluginRuntimeSyncEffect?.()
  stopPluginRuntimeSyncEffect = null
  pluginRuntimeSyncState.suppressionDepth = 0
  pluginRuntimeSyncState.targetSignature = null
}

let pluginLoadQueue: Promise<void> | null = null
let pluginLoadQueued = false

async function runQueuedPluginLoads() {
  while (pluginLoadQueued) {
    pluginLoadQueued = false
    console.log('Loading plugins...')
    const db = getDatabase()

    const enabledPlugins = acceptedPluginRuntimeProjection(db.plugins ?? []).filter((p: RisuPlugin) => p.enabled)
    const pluginV2 = enabledPlugins.filter((a: RisuPlugin) => a.version === 2 || a.version === '2.1')
    const pluginV3 = enabledPlugins.filter((a: RisuPlugin) => a.version === '3.0')

    await loadV2Plugin(pluginV2)
    await loadV3Plugins(pluginV3)
  }
}

export function loadPlugins(): Promise<void> {
  pluginRuntimeSyncState.targetSignature = pluginRuntimeSignature(
    acceptedPluginRuntimeProjection(getDatabase().plugins ?? []),
  )
  pluginLoadQueued = true
  pluginLoadQueue ??= runQueuedPluginLoads().finally(() => {
    pluginLoadQueue = null
    // A state projection can land after the queue's final loop condition but
    // before this cleanup callback. Do not strand that last requested target.
    if (pluginLoadQueued) {
      void loadPlugins().catch((error) => {
        console.error('Failed to process queued plugin runtime reload:', error)
      })
    }
  })
  return pluginLoadQueue
}

export type PluginV2ProviderArgument = {
  prompt_chat: OpenAIChat[]
  frequency_penalty: number
  min_p: number
  presence_penalty: number
  repetition_penalty: number
  top_k: number
  top_p: number
  temperature: number
  mode: string
  max_tokens: number
}

export type PluginV2ProviderOptions = {
  tokenizer?: string
  tokenizerFunc?: (content: string) => number[] | Promise<number[]>
}

export type EditFunction = (content: string) => string | null | undefined | Promise<string | null | undefined>
type ReplacerFunction = (content: OpenAIChat[], type: string) => OpenAIChat[] | Promise<OpenAIChat[]>

export const pluginV2 = {
  providers: new Map<
    string,
    (
      arg: PluginV2ProviderArgument,
      abortSignal?: AbortSignal,
    ) => Promise<{ success: boolean; content: string | ReadableStream<string> }>
  >(),
  providerOptions: new Map<string, PluginV2ProviderOptions>(),
  editdisplay: new Set<EditFunction>(),
  editoutput: new Set<EditFunction>(),
  editprocess: new Set<EditFunction>(),
  editinput: new Set<EditFunction>(),
  replacerbeforeRequest: new Set<ReplacerFunction>(),
  replacerafterRequest: new Set<(content: string, type: string) => string | Promise<string>>(),
  unload: new Set<() => void | Promise<void>>(),
  loaded: false,
}

const V2_PLUGIN_UNLOAD_TIMEOUT_MS = 1000
let v2PluginLoadGeneration = 0

async function runV2PluginUnloadCallbacks(callbacks: Array<() => void | Promise<void>>) {
  if (callbacks.length === 0) return

  const pendingCallbacks = callbacks.map(async (unload) => {
    try {
      await unload()
    } catch (error) {
      console.error('Error running V2 plugin unload callback:', error)
    }
  })

  await Promise.race([Promise.all(pendingCallbacks), sleep(V2_PLUGIN_UNLOAD_TIMEOUT_MS)])
}

function clearV2PluginRegistrations() {
  pluginV2.providers.clear()
  pluginV2.providerOptions.clear()
  pluginV2.editdisplay.clear()
  pluginV2.editoutput.clear()
  pluginV2.editprocess.clear()
  pluginV2.editinput.clear()
  pluginV2.replacerbeforeRequest.clear()
  pluginV2.replacerafterRequest.clear()
  pluginV2.unload.clear()
  customProviderStore.set([])
}

export const allowedDbKeys = [
  'characters',
  'modules',
  'enabledModules',
  'moduleIntergration',
  'pluginV2',
  'personas',
  'plugins',
  'pluginCustomStorage',
  'currentPluginProvider',
  'customModels',
  'customSidebarItems',
  'globalChatVariables',
  'jailbreakToggle',
  'banCharacterset',
  'allowAllExtentionFiles',
  'auxModelUnderModelSettings',
  'pluginDevelopMode',
  'temperature',
  'askRemoval',
  'maxContext',
  'maxResponse',
  'frequencyPenalty',
  'PresensePenalty',
  'theme',
  'textTheme',
  'lineHeight',
  'seperateModelsForAxModels',
  'seperateModels',
  'customCSS',
  'guiHTML',
  'colorSchemeName',
  'selectedPersona',
  'characterOrder',
]

// Recognized database families that the plugin bridge cannot translate into
// typed commands. In server-backed (Fastify) web mode we block writes to these
// keys instead of doing a dangling projection write that no command persists,
// or shadowing the real resource inside `pluginCustomStorage`. Plugins must use
// the dedicated module/plugin/storage APIs or settings for these in server
// mode.
export const unsupportedServerBridgeKeys = new Set<string>([
  'characters',
  'characterOrder',
  'personas',
  'selectedPersona',
  'userIcon',
  'personaPrompt',
  'userNote',
  'botPresets',
  'botPresetsId',
  'promptTemplate',
  'promptSettings',
  'translatorPresets',
  'translatorPresetId',
  'loadouts',
  'lastLoadedLoadoutName',
  'loreBook',
  'loreBookPage',
  'pluginV2',
])

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function pluginCustomStorage(): Record<string, unknown> {
  const db = getDatabase()
  db.pluginCustomStorage ??= {}
  return db.pluginCustomStorage as Record<string, unknown>
}

async function setPluginStorageValue(key: string, value: unknown): Promise<void> {
  const previous = currentPluginStorageSnapshot()
  withTrustedResourceWrite(() => {
    pluginCustomStorage()[key] = cloneJsonValue(value)
  })
  if (canUseServerCommands()) {
    await requirePluginMutation(dispatchPutPluginStorage(key, value, previous), 'set plugin storage')
  }
}

async function deletePluginStorageValue(key: string): Promise<void> {
  const previous = currentPluginStorageSnapshot()
  withTrustedResourceWrite(() => {
    delete pluginCustomStorage()[key]
  })
  if (canUseServerCommands()) {
    await requirePluginMutation(dispatchDeletePluginStorage(key, previous), 'delete plugin storage')
  }
}

async function replacePluginStorage(values: Record<string, unknown>): Promise<void> {
  const previous = currentPluginStorageSnapshot()
  withTrustedResourceWrite(() => {
    getDatabase().pluginCustomStorage = cloneJsonValue(values)
  })
  if (canUseServerCommands()) {
    await requirePluginMutation(dispatchBulkPluginStorage({ values, clear: true }, previous), 'replace plugin storage')
  }
}

async function requirePluginMutation(
  pending:
    | ReturnType<typeof dispatchPutPluginStorage>
    | ReturnType<typeof dispatchDeletePluginStorage>
    | ReturnType<typeof dispatchBulkPluginStorage>,
  action: string,
): Promise<void> {
  if (!pending) return
  const outcome = await pending
  if (outcome.status === 'failed') {
    throw new Error(`Failed to ${action}.`)
  }
}

async function applyPluginDatabasePatch(newDb: Record<string, unknown>, options: { full: boolean }): Promise<void> {
  const previous = currentPluginStateSnapshot()
  const previousModules = 'modules' in newDb || 'enabledModules' in newDb ? currentGlobalModuleStateSnapshot() : null
  const settingsRollback = currentPluginSettingsPatchRollbackSnapshot(newDb)
  const serverMode = canUseServerCommands()
  const settingsPatch: Record<string, unknown> = {}
  const storageValues: Record<string, unknown> = {}
  const blockedKeys: string[] = []
  const persistence: Array<Promise<{ status: 'accepted' | 'queued' | 'failed' }>> = []
  let replacedStorage: Record<string, unknown> | null = null

  for (const [key, value] of Object.entries(newDb)) {
    if (key === 'pluginCustomStorage') {
      replacedStorage =
        value && typeof value === 'object' && !Array.isArray(value)
          ? cloneJsonValue(value as Record<string, unknown>)
          : {}
      withTrustedResourceWrite(() => {
        getDatabase().pluginCustomStorage = cloneJsonValue(replacedStorage)
      })
      continue
    }

    // Recognized resource families without a bridge command: block in server
    // mode rather than writing a projection change no command will persist, or
    // shadowing the real resource in plugin storage.
    if (serverMode && unsupportedServerBridgeKeys.has(key)) {
      blockedKeys.push(key)
      continue
    }

    if (allowedDbKeys.includes(key)) {
      withTrustedResourceWrite(() => {
        ;(getDatabase() as any)[key] = cloneJsonValue(value)
      })
      if (key === 'currentPluginProvider' && typeof value === 'string') {
        const pending = dispatchSelectPluginProvider(value, previous)
        if (pending) persistence.push(pending)
      } else if (key === 'plugins' && Array.isArray(value)) {
        persistence.push(dispatchPluginCollectionPatch(value as RisuPlugin[], previous))
      } else if (key === 'modules' && Array.isArray(value) && previousModules) {
        const pending = dispatchModuleCollectionPatch(value as RisuModule[], previousModules)
        if (pending) {
          persistence.push(
            pending.then((outcome) => ({
              status:
                outcome.status === 'ok' ? ('accepted' as const) : outcome.status === 'retained' ? 'queued' : 'failed',
            })),
          )
        }
      } else if (key === 'enabledModules' && Array.isArray(value) && previousModules) {
        const moduleSource = Array.isArray(newDb.modules) ? (newDb.modules as RisuModule[]) : getDatabase().modules
        const pending = dispatchEnabledModulesPatch(value, previousModules, moduleSource ?? [])
        if (pending) {
          persistence.push(
            pending.then((outcome) => ({
              status:
                outcome.status === 'ok' ? ('accepted' as const) : outcome.status === 'retained' ? 'queued' : 'failed',
            })),
          )
        }
      } else {
        settingsPatch[key] = value
      }
      continue
    }

    storageValues[key] = cloneJsonValue(value)
    withTrustedResourceWrite(() => {
      pluginCustomStorage()[key] = cloneJsonValue(value)
    })
  }

  if (replacedStorage) {
    const storagePrevious = previous.pluginCustomStorage
    const pending = dispatchBulkPluginStorage(
      { values: { ...replacedStorage, ...storageValues }, clear: true },
      storagePrevious,
    )
    if (pending) persistence.push(pending)
  } else if (Object.keys(storageValues).length > 0) {
    const pending = dispatchBulkPluginStorage({ values: storageValues }, previous.pluginCustomStorage)
    if (pending) persistence.push(pending)
  }

  if (Object.keys(settingsPatch).length > 0) {
    persistence.push(dispatchPluginSettingsPatch(settingsPatch, settingsRollback))
  }

  if (blockedKeys.length > 0) {
    console.warn(
      '[plugin db bridge] Ignored unsupported database keys in server-backed mode: ' +
        `${blockedKeys.join(', ')}. Use the dedicated plugin/module/storage APIs or settings instead.`,
    )
  }

  if (!serverMode && options.full) {
    setDatabase(getDatabase({ snapshot: true }))
  }

  const outcomes = await Promise.all(persistence)
  if (outcomes.some((outcome) => outcome.status === 'failed')) {
    throw new Error('One or more plugin database changes could not be saved.')
  }
}

export const getV2PluginAPIs = (plugin?: Pick<RisuPlugin, 'name' | 'script'>, assertActive?: () => void) => {
  const networkAccess = createPluginNetworkAccess(
    plugin,
    {
      risuFetch: pluginGlobalFetch,
      nativeFetch: pluginFetchNative,
    },
    undefined,
    assertActive,
  )
  const webFetch = createPluginWebFetch(networkAccess)
  let pluginApis: any
  pluginApis = {
    risuFetch: networkAccess.risuFetch,
    nativeFetch: networkAccess.nativeFetch,
    fetch: webFetch,
    BlockedPluginNetworkPrimitive,
    safeNavigator: SafePluginNavigator,
    safeLocation: SafePluginLocation,
    getArg: (arg: string) => {
      const db = getDatabase()
      const [name, realArg] = arg.split('::')
      for (const plugin of db.plugins) {
        if (plugin.name === name) {
          return plugin.realArg[realArg]
        }
      }
    },
    getChar: () => {
      return getCurrentCharacter({ snapshot: true })
    },
    setChar: (char: any) => {
      const charid = get(selectedCharID)
      if (!canUseServerCommands()) {
        withTrustedResourceWrite(() => {
          getDatabase().characters[charid] = char
        })
        return
      }

      const previousCharacter = getDatabase().characters?.[charid]
      assertNoUnsupportedCharacterChanges(previousCharacter, char, 'setChar')
      const previous = currentCharacterRowSnapshot(charid)
      const previousCharacterSnapshot = previousCharacter ? $state.snapshot(previousCharacter) : undefined
      const preparation = prepareCompatibleCharacterUpdateScoped(previousCharacterSnapshot, char, previous)
      const optimisticCharacter = preparation.optimisticCharacter
      if (!optimisticCharacter || preparation.factories.length === 0) return
      withTrustedResourceWrite(() => {
        getDatabase().characters[charid] = optimisticCharacter
      })
      preparation.dispatch()
    },
    addProvider: (
      name: string,
      func: (
        arg: PluginV2ProviderArgument,
        abortSignal?: AbortSignal,
      ) => Promise<{ success: boolean; content: string }>,
      options?: PluginV2ProviderOptions,
    ) => {
      pluginV2.providers.set(name, func)
      pluginV2.providerOptions.set(name, options ?? {})
      customProviderStore.set(Array.from(pluginV2.providers.keys()))
    },
    addRisuScriptHandler: (name: ScriptMode, func: EditFunction) => {
      if (pluginV2['edit' + name]) {
        pluginV2['edit' + name].add(func)
      } else {
        throw `script handler named ${name} not found`
      }
    },
    removeRisuScriptHandler: (name: ScriptMode, func: EditFunction) => {
      if (pluginV2['edit' + name]) {
        pluginV2['edit' + name].delete(func)
      } else {
        throw `script handler named ${name} not found`
      }
    },
    addRisuReplacer: (name: string, func: ReplacerFunction) => {
      if (pluginV2['replacer' + name]) {
        pluginV2['replacer' + name].add(func)
      } else {
        throw `replacer handler named ${name} not found`
      }
    },
    removeRisuReplacer: (name: string, func: ReplacerFunction) => {
      if (pluginV2['replacer' + name]) {
        pluginV2['replacer' + name].delete(func)
      } else {
        throw `replacer handler named ${name} not found`
      }
    },
    onUnload: (func: () => void | Promise<void>) => {
      pluginV2.unload.add(func)
    },
    setArg: (arg: string, value: string | number) => {
      const [name, realArg] = arg.split('::')
      const previous = currentPluginStateSnapshot()
      let matched = false
      withTrustedResourceWrite(() => {
        const db = getDatabase()
        for (const plugin of db.plugins) {
          if (plugin.name === name) {
            plugin.realArg[realArg] = value
            matched = true
          }
        }
      })
      if (matched) {
        const plugin = getDatabase().plugins.find((p) => p.name === name)
        if (plugin) {
          dispatchUpdatePlugin(plugin.name, { realArg: plugin.realArg }, previous)
        }
      }
    },
    safeGlobalThis: {} as any,
    getSafeGlobalThis: () => {
      if (Object.keys(pluginApis.safeGlobalThis).length > 0) {
        return pluginApis.safeGlobalThis
      }
      const keys = Object.keys(globalThis)
      const safeGlobal: any = {}
      const allowedKeys = ['console', 'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams']
      for (const key of keys) {
        if (allowedKeys.includes(key)) {
          safeGlobal[key] = (globalThis as any)[key]
        }
      }

      //compatibility layer with old unsafe APIs

      //from PBV2
      safeGlobal.showDirectoryPicker = window.showDirectoryPicker

      safeGlobal.setInterval = (...args: any[]) => {
        //@ts-expect-error spreading any[] into setInterval params causes type mismatch with TimerHandler signature
        return globalThis.setInterval(...args)
      }
      safeGlobal.setTimeout = (...args: any[]) => {
        //@ts-expect-error spreading any[] into setTimeout params causes type mismatch with TimerHandler signature
        return globalThis.setTimeout(...args)
      }
      safeGlobal.clearInterval = (...args: any[]) => {
        //@ts-expect-error spreading any[] into clearInterval - first arg should be number | undefined
        return globalThis.clearInterval(...args)
      }
      safeGlobal.clearTimeout = (...args: any[]) => {
        //@ts-expect-error spreading any[] into clearTimeout - first arg should be number | undefined
        return globalThis.clearTimeout(...args)
      }
      safeGlobal.alert = globalThis.alert
      safeGlobal.confirm = globalThis.confirm
      safeGlobal.prompt = globalThis.prompt
      safeGlobal.innerWidth = window.innerWidth
      safeGlobal.innerHeight = window.innerHeight
      safeGlobal.getComputedStyle = window.getComputedStyle
      safeGlobal.navigator = pluginApis.safeNavigator
      safeGlobal.location = pluginApis.safeLocation
      safeGlobal.localStorage = pluginApis.safeLocalStorage
      safeGlobal.indexedDB = pluginApis.safeIdbFactory
      safeGlobal.__pluginApis__ = pluginApis
      safeGlobal.Object = Object
      safeGlobal.Array = Array
      safeGlobal.String = String
      safeGlobal.Number = Number
      safeGlobal.Boolean = Boolean
      safeGlobal.Math = Math
      safeGlobal.Date = Date
      safeGlobal.RegExp = RegExp
      safeGlobal.Error = Error
      safeGlobal.Function = pluginApis.SafeFunction
      safeGlobal.document = pluginApis.safeDocument
      safeGlobal.addEventListener = (...args: any[]) => {
        //@ts-expect-error spreading any[] into addEventListener - expects (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions)
        window.addEventListener(...args)
      }
      safeGlobal.removeEventListener = (...args: any[]) => {
        //@ts-expect-error spreading any[] into removeEventListener - expects (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions)
        window.removeEventListener(...args)
      }
      return safeGlobal
    },
    safeLocalStorage: new SafeLocalStorage(),
    safeIdbFactory: SafeIdbFactory,
    safeDocument: SafeDocument,
    alertStore: {
      set: (msg: string) => {},
    },
    apiVersion: '2.1',
    apiVersionCompatibleWith: ['2.0', '2.1'],
    getDatabase: () => {
      const db = getDatabase()
      return new Proxy(db, {
        get(target, prop) {
          if (typeof prop === 'string' && allowedDbKeys.includes(prop)) {
            return (target as any)[prop]
          } else if (typeof prop === 'string' && canUseServerCommands() && unsupportedServerBridgeKeys.has(prop)) {
            return undefined
          } else if (target.pluginCustomStorage) {
            return target.pluginCustomStorage[prop.toString()]
          }
          return undefined
        },
        set(target, prop, value) {
          if (typeof prop === 'string' && allowedDbKeys.includes(prop)) {
            if (canUseServerCommands()) {
              void applyPluginDatabasePatch({ [prop]: value }, { full: false }).catch((error) => {
                console.error('Plugin database property save failed:', error)
              })
            } else {
              ;(target as any)[prop] = value
            }
            return true
          } else if (typeof prop === 'string' && canUseServerCommands() && unsupportedServerBridgeKeys.has(prop)) {
            // Recognized resource family with no bridge command: route through
            // applyPluginDatabasePatch so it is blocked + warned instead of
            // being silently shadowed in plugin storage.
            void applyPluginDatabasePatch({ [prop]: value }, { full: false }).catch((error) => {
              console.error('Plugin database property save failed:', error)
            })
            return true
          } else {
            void setPluginStorageValue(prop.toString(), value).catch((error) => {
              console.error('Plugin storage property save failed:', error)
            })
            return true
          }
        },
        ownKeys(target) {
          const keys = Reflect.ownKeys(target).filter((key) => typeof key === 'string' && allowedDbKeys.includes(key))
          if (target.pluginCustomStorage) {
            keys.push(
              ...Object.keys(target.pluginCustomStorage).filter(
                (key) => !canUseServerCommands() || !unsupportedServerBridgeKeys.has(key),
              ),
            )
          }
          return keys
        },
        getOwnPropertyDescriptor(target, prop) {
          if (typeof prop !== 'string') {
            return Reflect.getOwnPropertyDescriptor(target, prop)
          }
          if (allowedDbKeys.includes(prop)) {
            return Reflect.getOwnPropertyDescriptor(target, prop)
          }
          if (canUseServerCommands() && unsupportedServerBridgeKeys.has(prop)) {
            return undefined
          }
          if (target.pluginCustomStorage && prop in target.pluginCustomStorage) {
            return {
              configurable: true,
              enumerable: true,
              writable: true,
              value: target.pluginCustomStorage[prop],
            }
          }
          return undefined
        },
        deleteProperty(target, prop) {
          console.log('Attempt to delete db.' + String(prop) + ' denied in safe database proxy.')
          return false
        },
        getPrototypeOf(target) {
          return Reflect.getPrototypeOf(target)
        },
      })
    },
    pluginStorage: {
      getItem: (key: string) => {
        const value = getDatabase().pluginCustomStorage?.[key]
        return value == null ? null : safeStructuredClone(value)
      },
      setItem: (key: string, value: string) => {
        return setPluginStorageValue(key, value)
      },
      removeItem: (key: string) => {
        return deletePluginStorageValue(key)
      },
      clear: () => {
        return replacePluginStorage({})
      },
      key: (index: number) => {
        const db = getDatabase()
        db.pluginCustomStorage ??= {}
        const keys = Object.keys(db.pluginCustomStorage)
        return keys[index] || null
      },
      keys: () => {
        const db = getDatabase()
        db.pluginCustomStorage ??= {}
        return Object.keys(db.pluginCustomStorage)
      },
      length: () => {
        const db = getDatabase()
        db.pluginCustomStorage ??= {}
        return Object.keys(db.pluginCustomStorage).length
      },
    },
    isDeviceLocalPluginStorageEnabled,
    setDatabaseLite: (newDb: any) => {
      const pending = applyPluginDatabasePatch(newDb, { full: false })
      // Legacy V2.1 scripts commonly ignored this historically synchronous
      // return value. Keep those calls from becoming unhandled rejections while
      // still returning the rejecting Promise to callers that correctly await.
      void pending.catch(() => undefined)
      return pending
    },
    setDatabase: async (newDb: any) => {
      for (const key of Object.keys(newDb)) {
        if (key === 'plugins') {
          console.warn(
            '[WARN] Plugin attempted to access plugin directly. this would be blocked in future versions. Instead, use the provided APIs to manage plugins. Attempting to handle plugin installation via plugin for new plugins in the provided database object.',
          )
          newDb[key] = await handlePluginInstallViaPlugin(newDb.plugins)
        }
      }
      await applyPluginDatabasePatch(newDb, { full: true })
    },
    SafeFunction: new Proxy(Function, {
      construct(target, args) {
        return function () {
          return pluginApis.getSafeGlobalThis()
        }
      },
      apply(target, thisArg, args) {
        return function () {
          return pluginApis.getSafeGlobalThis()
        }
      },
    }),
    loadPlugins: loadPlugins,
    readImage: (path: string) => {
      if (path.startsWith('assets/')) {
        // Normalize the supported `assets/` prefix before validating the asset id.
        path = path.slice(7)
      }
      if (path.includes('/') || path.includes('\\')) {
        throw new Error("readImage path cannot contain '/' or '\\' for security reasons, except assets/ prefix.")
      }
      // Re-add the canonical prefix expected by `readImage`.
      return readImage('assets/' + path)
    },
    saveAsset: (data: Uint8Array) => {
      // plugin V2 bridge API has no extension hint;
      // plugins that need an honest extension should use the V3 API which
      // accepts a filename.
      return saveAsset(data)
    },
  }
  return pluginApis
}

export async function loadV2Plugin(plugins: RisuPlugin[]) {
  const loadGeneration = ++v2PluginLoadGeneration
  if (pluginV2.loaded) {
    const unloadCallbacks = Array.from(pluginV2.unload)
    try {
      await runV2PluginUnloadCallbacks(unloadCallbacks)
    } finally {
      clearV2PluginRegistrations()
    }
  }

  pluginV2.loaded = true

  globalThis.__pluginApis__ = getV2PluginAPIs()

  for (const plugin of plugins) {
    let data = ''
    let version = plugin.version || 2

    const createRealScript = (data: string): string => {
      const tt = (
        window as unknown as Window & {
          trustedTypes?: {
            createPolicy: (
              name: string,
              rules: { createScript: (input: string) => string },
            ) => { createScript: (input: string) => string }
          }
        }
      ).trustedTypes
      const policyFactory = tt ?? {
        createPolicy: (_name: string, rules: { createScript: (input: string) => string }) => rules, // Just return the rules object as the "policy"
      }

      const policy = policyFactory.createPolicy('plugin-policy', {
        createScript: (_input) => {
          return `(async () => {
                        const __pluginApi = globalThis.__pluginApis__
                        const risuFetch = __pluginApi.risuFetch
                        const nativeFetch = __pluginApi.nativeFetch
                        const fetch = __pluginApi.fetch
                        const XMLHttpRequest = __pluginApi.BlockedPluginNetworkPrimitive
                        const WebSocket = __pluginApi.BlockedPluginNetworkPrimitive
                        const WebSocketStream = __pluginApi.BlockedPluginNetworkPrimitive
                        const EventSource = __pluginApi.BlockedPluginNetworkPrimitive
                        const Image = __pluginApi.BlockedPluginNetworkPrimitive
                        const Audio = __pluginApi.BlockedPluginNetworkPrimitive
                        const Worker = __pluginApi.BlockedPluginNetworkPrimitive
                        const SharedWorker = __pluginApi.BlockedPluginNetworkPrimitive
                        const WebTransport = __pluginApi.BlockedPluginNetworkPrimitive
                        const RTCPeerConnection = __pluginApi.BlockedPluginNetworkPrimitive
                        const Navigator = __pluginApi.BlockedPluginNetworkPrimitive
                        const open = __pluginApi.BlockedPluginNetworkPrimitive
                        const navigator = __pluginApi.safeNavigator
                        const location = __pluginApi.safeLocation
                        const getArg = __pluginApi.getArg
                        const printLog = __pluginApi.printLog
                        const getChar = __pluginApi.getChar
                        const setChar = __pluginApi.setChar
                        const addProvider = __pluginApi.addProvider
                        const addRisuScriptHandler = __pluginApi.addRisuScriptHandler
                        const removeRisuScriptHandler = __pluginApi.removeRisuScriptHandler
                        const addRisuReplacer = __pluginApi.addRisuReplacer
                        const removeRisuReplacer = __pluginApi.removeRisuReplacer
                        const onUnload = __pluginApi.onUnload
                        const setArg = __pluginApi.setArg
                        const saveAsset = __pluginApi.saveAsset
                        const readImage = __pluginApi.readImage
                        ${
                          version === '2.1'
                            ? `
                            const safeGlobalThis = __pluginApi.getSafeGlobalThis()
                            const Risuai = __pluginApi
                            const safeLocalStorage = __pluginApi.safeLocalStorage
                            const safeIdbFactory = __pluginApi.safeIdbFactory
                            const alertStore = __pluginApi.alertStore
                            const safeDocument = __pluginApi.safeDocument
                            const getDatabase = __pluginApi.getDatabase
                            const setDatabaseLite = __pluginApi.setDatabaseLite
                            const setDatabase = __pluginApi.setDatabase
                            const loadPlugins = __pluginApi.loadPlugins
                            const SafeFunction = __pluginApi.SafeFunction
                        `
                            : ''
                        }

                        ${data}
                    })();`
        },
      })

      return policy.createScript(data)
    }

    if (version === '2.1') {
      const legacyRuntimeAllowed = await getPluginPermission(plugin.name, 'legacyRuntime', false, plugin.script)
      if (loadGeneration !== v2PluginLoadGeneration) return
      if (!legacyRuntimeAllowed) {
        console.warn(`Skipped V2.1 plugin "${plugin.name}" because trusted legacy runtime access was denied.`)
        continue
      }

      const safety = await checkCodeSafety(plugin.script)
      if (loadGeneration !== v2PluginLoadGeneration) return
      data = safety.modifiedCode

      try {
        // Each script captures an API object whose network grant is bound to
        // this exact plugin name and script, never the ambient last-loaded API.
        globalThis.__pluginApis__ = getV2PluginAPIs(plugin, () => {
          if (loadGeneration !== v2PluginLoadGeneration) {
            throw new Error('Legacy plugin instance is no longer active.')
          }
        })
        new Function(createRealScript(data))()
      } catch (error) {
        console.error(error)
      }

      console.log('Loaded V2.1 Plugin', plugin.name)
    } else {
      data = plugin.script
      console.log('Loading V2.0 Plugin', plugin.name)

      console.warn(
        `Plugin 2.0 is removed and no longer supported. Please update plugin "${plugin.name}" to API version 3.0`,
      )
    }
  }
}

export async function translatorPlugin(text: string, from: string, to: string) {
  return false
}

export async function pluginProcess(
  arg:
    | {
        prompt_chat: OpenAIChat
        temperature: number
        max_tokens: number
        presence_penalty: number
        frequency_penalty: number
        bias: { [key: string]: string }
      }
    | {},
) {
  return {
    success: false,
    content: language.pluginProviderNotFound,
  }
}

export async function handlePluginInstallViaPlugin(plugins: RisuPlugin[]) {
  const trimmedPlugins: RisuPlugin[] = []
  for (const plugin of plugins) {
    if (!getDatabase().plugins.find((p: RisuPlugin) => p.name === plugin.name && p.script === plugin.script)) {
      if (plugin.version !== '3.0') {
        console.warn(
          `Plugin "${plugin.name}" has version "${plugin.version}", which is not supported for installation via plugin. Only API version 3.0 plugins can be installed via plugin. Skipping installation of this plugin.`,
        )
        continue
      }
      const confirmation = await alertConfirm(language.confirmInstallPluginViaPlugin.replace('{plugin}', plugin.name))
      if (confirmation) {
        trimmedPlugins.push(plugin)
      }
    } else {
      console.warn(`Plugin "${plugin.name}" already exists, skipping installation via plugin.`)
    }
  }

  return trimmedPlugins
}
