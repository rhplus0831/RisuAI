import { get, writable } from 'svelte/store'
import { language } from '../../lang'
import {
  getCurrentCharacter,
  getDatabase,
  setDatabase,
  setDatabaseLite,
} from '../storage/database.svelte'
import { alertConfirm, alertError, alertPluginConfirm } from '../alert'
import { selectSingleFile, sleep } from '../util'
import type { OpenAIChat } from '../process/index.svelte'
import { fetchNative, globalFetch, readImage, saveAsset, toGetter } from '../globalApi.svelte'
import { DBState, hotReloading, pluginAlertModalStore, selectedCharID } from '../stores.svelte'
import type { ScriptMode } from '../process/scripts'
import type { RisuModule } from '../process/modules'
import { checkCodeSafety } from './pluginSafety'
import {
  SafeDocument,
  SafeIdbFactory,
  SafeLocalStorage,
  isDeviceLocalPluginStorageEnabled,
} from './pluginSafeClass'
import { loadV3Plugins } from './apiV3/v3.svelte'
import { pluginCodeTranspiler } from './apiV3/transpiler'
import {
  currentPluginStorageSnapshot,
  currentPluginStateSnapshot,
  dispatchBulkPluginStorage,
  dispatchCreatePlugin,
  dispatchDeletePlugin,
  dispatchDeletePluginStorage,
  dispatchPluginSettingsPatch,
  dispatchPutPluginStorage,
  dispatchReorderPlugins,
  dispatchSelectPluginProvider,
  dispatchUpdatePlugin,
  toPluginSnapshot,
} from '../pluginCommands'
import {
  currentModuleStateSnapshot,
  restoreModuleState,
  sanitizeModulePatch,
  toModuleSnapshot,
} from '../moduleCommands'
import {
  currentCharacterStateSnapshot,
  dispatchCompatibleCharacterUpdate,
} from '../characterCommands'
import { runOptimisticCommandSequence } from '../chatCommands'
import {
  canUseServerCommands,
  createModuleCommand,
  deleteModuleCommand,
  enableModuleCommand,
  reorderModulesCommand,
  updateModuleCommand,
  type ServerCommandResult,
} from '../server/commands'
import { withTrustedServerProjectionWrite } from '../server/projectionWriteGuard.svelte'

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

const compareVersions = (v1: string, v2: string): 0 | 1 | -1 => {
  const v1parts = v1.split('.').map(Number)
  const v2parts = v2.split('.').map(Number)
  const len = Math.max(v1parts.length, v2parts.length)
  for (let i = 0; i < len; i++) {
    const part1 = v1parts[i] || 0
    const part2 = v2parts[i] || 0
    if (part1 > part2) return 1
    if (part1 < part2) return -1
  }
  return 0
}

const updateCache = new Map<string, { version: string; updateURL: string } | undefined>()

export const checkPluginUpdate = async (plugin: RisuPlugin) => {
  try {
    if (!plugin.updateURL) {
      return
    }

    if (updateCache.has(plugin.name)) {
      const cached = updateCache.get(plugin.name)
      if (compareVersions(cached.version, plugin.versionOfPlugin || '0.0.0') === 1) {
        return cached
      }
    }

    const response = await fetch(plugin.updateURL, {
      method: 'GET',
      headers: {
        Range: 'bytes=0-512',
      },
    })

    if (response.status >= 200 && response.status < 300) {
      const text = await response.text()
      const versioRegex = /\/\/@version\s+([^\s]+)/
      const match = text.match(versioRegex)
      if (match && match[1]) {
        const latestVersion = match[1].trim()
        if (compareVersions(latestVersion, plugin.versionOfPlugin || '0.0.0') === 1) {
          updateCache.set(plugin.name, {
            version: latestVersion,
            updateURL: plugin.updateURL,
          })
          return {
            version: latestVersion,
            updateURL: plugin.updateURL,
          }
        }
      }
    }
  } catch (error) {
    console.warn('Failed to check plugin update:', error)
  }
}

export async function updatePlugin(plugin: RisuPlugin) {
  try {
    if (!plugin.updateURL) {
      return false
    }
    const response = await fetch(plugin.updateURL)
    if (response.status >= 200 && response.status < 300) {
      const jsFile = await response.text()
      await importPlugin(jsFile, {
        isUpdate: true,
        originalPluginName: plugin.name,
      })
      return true
    }
  } catch (error) {
    console.error('Failed to update plugin:', error)
  }
  return false
}

export async function importPlugin(
  code: string | null = null,
  argu: {
    isUpdate?: boolean
    originalPluginName?: string
    isHotReload?: boolean
    isTypescript?: boolean
  } = {},
) {
  try {
    let jsFile = ''
    let isUpdate = argu.isUpdate || false
    let originalPluginName = argu.originalPluginName || ''
    let isTypescript = argu.isTypescript || false

    if (!code) {
      const f = await selectSingleFile(['js', 'ts'])
      if (!f) {
        return
      }
      if (f.name.endsWith('.ts')) {
        isTypescript = true
      }
      //support utf-8 with BOM or without BOM
      jsFile = Buffer.from(f.data)
        .toString('utf-8')
        .replace(/^\uFEFF/gm, '')
    } else {
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

    const showError = (msg: string) => {
      if (argu.isHotReload) {
        console.error(`Hot-reload plugin "${name}" error: ${msg}`)
      } else {
        alertError(msg)
      }
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
          showError('plugin name must be longer than 0, did you put it correctly?')
          return
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
          showError('plugin display name must be longer than 0, did you put it correctly?')
          return
        }
        displayName = provied.trim()
      }

      if (line.startsWith('//@link')) {
        const link = line.split(' ')[1]
        if (!link || link === '') {
          showError('plugin link is empty, did you put it correctly?')
          return
        }
        if (!link.startsWith('https')) {
          showError('plugin link must start with https, did you check it?')
          return
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
          showError('plugin argument is incorrect, did you put space in argument name?')
          return
        }
        const provKey = provied[1]

        if (provied[2] !== 'int' && provied[2] !== 'string') {
          showError(`plugin argument type is "${provied[2]}", which is an unknown type.`)
          return
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
            showError('plugin update URL must start with https, did you put it correctly?')
            return
          }
        } catch (error) {
          showError('plugin update URL is not a valid URL, did you put it correctly?')
          return
        }
      }

      if (line.startsWith('//@version')) {
        versionOfPlugin = line.split(' ').slice(1).join(' ').trim()

        const versionLocation = jsFile.indexOf('//@version')
        const numberOfBytesBefore = new TextEncoder().encode(
          jsFile.slice(0, versionLocation) + line,
        ).length
        if (numberOfBytesBefore > 500) {
          showError(
            'plugin version declaration must be within the first 512 Bytes of the file for proper parsing. move //@version line to the top of the file.',
          )
          return
        }
      }

      if (line.startsWith('//@allowed-ipc')) {
        const provied = line.trim().split(' ')
        if (provied.length < 2) {
          showError(
            'plugin allowed IPC declaration is incorrect, did you put space after //@allowed-ipc?',
          )
          return
        }

        const allowedIPCList = provied.slice(1)

        ipcList.push(...allowedIPCList)
      }
    }

    if (name.length === 0) {
      showError('plugin name not found, did you put it correctly?')
      return
    }

    if (updateURL && versionOfPlugin.length === 0) {
      showError(
        'plugin version not found, did you put it correctly? It is required when update URL is provided.',
      )
      return
    }

    if (versionOfPlugin && compareVersions(versionOfPlugin, '0.0.1') === -1) {
      showError('plugin version must be at least 0.0.1')
      return
    }

    if (isTypescript) {
      try {
        jsFile = await pluginCodeTranspiler(jsFile)
      } catch (error) {
        showError('Failed to transpile TypeScript code: ' + error.message)
      }
    }

    let apiInternalVersion: 2 | '2.1' | '3.0' = '2.1'

    if (apiVersion === '2.1') {
      const safety = await checkCodeSafety(jsFile)
      if (!safety.isSafe) {
        pluginAlertModalStore.errors = safety.errors
        pluginAlertModalStore.open = true

        //I can use event but lazy
        while (pluginAlertModalStore.open) {
          await sleep(100)
        }

        if (pluginAlertModalStore.errors.length > 0) {
          return
        }
      }
      apiInternalVersion = '2.1'
    } else if (apiVersion === '2.0') {
      //Only block installing
      showError(
        'Your code does not include //@api or specifies API version 2.0, which is outdated. Please update your plugin to use at least API version 2.1.',
      )
      return
    } else if (apiVersion === '3.0') {
      apiInternalVersion = '3.0'
    }

    if (apiInternalVersion !== '3.0' && argu.isHotReload) {
      showError('Only API version 3.0 plugins can be hot-reloaded.')
      return
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

    withTrustedServerProjectionWrite(() => {
      const db = getDatabase()
      db.plugins ??= []
    })

    const oldPluginIndex = getDatabase().plugins.findIndex(
      (p: RisuPlugin) => p.name === pluginData.name,
    )

    if (originalPluginName && originalPluginName !== pluginData.name) {
      showError(
        `When updating plugin "${originalPluginName}", the plugin name cannot be changed to "${pluginData.name}". Please keep the original name to update.`,
      )
      return
    }

    if (!isUpdate && oldPluginIndex !== -1) {
      const c = await alertConfirm(language.duplicatePluginFoundUpdateIt)
      if (!c) {
        return
      }
    }

    const previous = currentPluginStateSnapshot()
    if (oldPluginIndex !== -1) {
      // Re-read the live database inside the trusted write scope so the
      // optimistic update never mutates the read-only server projection
      // through a stale reference captured before the scope.
      withTrustedServerProjectionWrite(() => {
        const db = getDatabase()
        db.plugins[oldPluginIndex] = pluginData
        setDatabaseLite(db)
      })
      dispatchUpdatePlugin(pluginData.name, toPluginSnapshot(pluginData), previous)
    } else if (!isUpdate || argu.isHotReload) {
      withTrustedServerProjectionWrite(() => {
        const db = getDatabase()
        db.plugins.push(pluginData)
        setDatabaseLite(db)
      })
      dispatchCreatePlugin(pluginData, previous)
    }

    if (argu.isHotReload && !hotReloading.includes(pluginData.name)) {
      hotReloading.push(pluginData.name)
    }

    console.log(`Imported plugin: ${pluginData.name} (API v${apiVersion})`)

    loadPlugins()
  } catch (error) {
    console.error(error)
    alertError(language.errors.noData)
  }
}

let pluginTranslator = false

export async function loadPlugins() {
  console.log('Loading plugins...')
  let db = getDatabase()

  const enabledPlugins = safeStructuredClone(db.plugins).filter((p: RisuPlugin) => p.enabled)
  const pluginV2 = enabledPlugins.filter((a: RisuPlugin) => a.version === 2 || a.version === '2.1')
  const pluginV3 = enabledPlugins.filter((a: RisuPlugin) => a.version === '3.0')

  await loadV2Plugin(pluginV2)
  await loadV3Plugins(pluginV3)
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

export type EditFunction = (
  content: string,
) => string | null | undefined | Promise<string | null | undefined>
type ReplacerFunction = (
  content: OpenAIChat[],
  type: string,
) => OpenAIChat[] | Promise<OpenAIChat[]>

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
// mode. The legacy local mode is unaffected and still writes them through
// `setDatabase`.
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
  DBState.db.pluginCustomStorage ??= {}
  return DBState.db.pluginCustomStorage as Record<string, unknown>
}

function setPluginStorageValue(key: string, value: unknown): void {
  const previous = currentPluginStorageSnapshot()
  withTrustedServerProjectionWrite(() => {
    pluginCustomStorage()[key] = cloneJsonValue(value)
  })
  if (canUseServerCommands()) {
    dispatchPutPluginStorage(key, value, previous)
  }
}

function deletePluginStorageValue(key: string): void {
  const previous = currentPluginStorageSnapshot()
  withTrustedServerProjectionWrite(() => {
    delete pluginCustomStorage()[key]
  })
  if (canUseServerCommands()) {
    dispatchDeletePluginStorage(key, previous)
  }
}

function replacePluginStorage(values: Record<string, unknown>): void {
  const previous = currentPluginStorageSnapshot()
  withTrustedServerProjectionWrite(() => {
    DBState.db.pluginCustomStorage = cloneJsonValue(values)
  })
  if (canUseServerCommands()) {
    dispatchBulkPluginStorage({ values, clear: true }, previous)
  }
}

function applyPluginDatabasePatch(
  newDb: Record<string, unknown>,
  options: { full: boolean },
): void {
  const previous = currentPluginStateSnapshot()
  const previousModules =
    'modules' in newDb || 'enabledModules' in newDb ? currentModuleStateSnapshot() : null
  const serverMode = canUseServerCommands()
  const settingsPatch: Record<string, unknown> = {}
  const storageValues: Record<string, unknown> = {}
  const blockedKeys: string[] = []
  let replacedStorage: Record<string, unknown> | null = null

  for (const [key, value] of Object.entries(newDb)) {
    if (key === 'pluginCustomStorage') {
      replacedStorage =
        value && typeof value === 'object' && !Array.isArray(value)
          ? cloneJsonValue(value as Record<string, unknown>)
          : {}
      withTrustedServerProjectionWrite(() => {
        DBState.db.pluginCustomStorage = cloneJsonValue(replacedStorage)
      })
      continue
    }

    // Recognized resource families without a bridge command: block in server
    // mode rather than writing a projection change no command will persist, or
    // shadowing the real resource in plugin storage. Local mode keeps writing
    // them (persisted by the trailing setDatabase below).
    if (serverMode && unsupportedServerBridgeKeys.has(key)) {
      blockedKeys.push(key)
      continue
    }

    if (allowedDbKeys.includes(key)) {
      withTrustedServerProjectionWrite(() => {
        ;(DBState.db as any)[key] = cloneJsonValue(value)
      })
      if (key === 'currentPluginProvider' && typeof value === 'string') {
        dispatchSelectPluginProvider(value, previous)
      } else if (key === 'plugins' && Array.isArray(value)) {
        dispatchPluginCollectionPatch(value as RisuPlugin[], previous)
      } else if (key === 'modules' && Array.isArray(value) && previousModules) {
        dispatchModuleCollectionPatch(value as RisuModule[], previousModules)
      } else if (key === 'enabledModules' && Array.isArray(value) && previousModules) {
        const moduleSource = Array.isArray(newDb.modules)
          ? (newDb.modules as RisuModule[])
          : DBState.db.modules
        dispatchEnabledModulesPatch(value, previousModules, moduleSource ?? [])
      } else {
        settingsPatch[key] = value
      }
      continue
    }

    storageValues[key] = cloneJsonValue(value)
    withTrustedServerProjectionWrite(() => {
      pluginCustomStorage()[key] = cloneJsonValue(value)
    })
  }

  if (replacedStorage) {
    const storagePrevious = previous.pluginCustomStorage
    dispatchBulkPluginStorage({ values: replacedStorage, clear: true }, storagePrevious)
  } else if (Object.keys(storageValues).length > 0) {
    dispatchBulkPluginStorage({ values: storageValues }, previous.pluginCustomStorage)
  }

  if (Object.keys(settingsPatch).length > 0) {
    dispatchPluginSettingsPatch(settingsPatch, previous)
  }

  if (blockedKeys.length > 0) {
    console.warn(
      '[plugin db bridge] Ignored unsupported database keys in server-backed mode: ' +
        `${blockedKeys.join(', ')}. Use the dedicated plugin/module/storage APIs or settings instead.`,
    )
  }

  if (!serverMode && options.full) {
    setDatabase(DBState.db)
  }
}

function dispatchPluginCollectionPatch(
  plugins: RisuPlugin[],
  previous: ReturnType<typeof currentPluginStateSnapshot>,
): void {
  if (!canUseServerCommands()) return

  const beforePlugins = new Map(previous.plugins.map((plugin) => [plugin.name, plugin]))
  const nextPlugins = new Map(plugins.map((plugin) => [plugin.name, plugin]))

  for (const plugin of plugins) {
    const before = beforePlugins.get(plugin.name)
    if (!before) {
      dispatchCreatePlugin(plugin, previous)
      continue
    }
    if (JSON.stringify(before) !== JSON.stringify(plugin)) {
      dispatchUpdatePlugin(plugin.name, toPluginSnapshot(plugin), previous)
    }
  }

  for (const plugin of previous.plugins) {
    if (!nextPlugins.has(plugin.name)) {
      dispatchDeletePlugin(plugin.name, previous)
    }
  }

  const beforeOrder = previous.plugins.map((plugin) => plugin.name).join('\n')
  const nextOrder = plugins.map((plugin) => plugin.name).join('\n')
  if (beforeOrder !== nextOrder && plugins.every((plugin) => beforePlugins.has(plugin.name))) {
    dispatchReorderPlugins(previous)
  }
}

function dispatchModuleCollectionPatch(
  modules: RisuModule[],
  previous: ReturnType<typeof currentModuleStateSnapshot>,
): void {
  if (!canUseServerCommands()) return

  const beforeModules = new Map(previous.modules.map((module) => [module.id, module]))
  const nextModules = new Map(modules.map((module) => [module.id, module]))

  // A4EC2 / B1: collect every diff into one sequenced factory list. Pre-fix
  // each create/update/delete/reorder fired against the shared optimistic
  // snapshot on the same cached baseRevision; only the first won, the rest
  // 409d. The sequencer awaits each response so the next reads the updated
  // revision.
  const factories: Array<(baseRevision: number) => Promise<ServerCommandResult>> = []

  for (const module of modules) {
    if (typeof module.id !== 'string' || module.id.trim() === '') continue
    const before = beforeModules.get(module.id)
    if (!before) {
      const moduleSnapshot = toModuleSnapshot(module)
      factories.push((baseRevision) =>
        createModuleCommand({ baseRevision, module: moduleSnapshot }),
      )
      continue
    }
    if (JSON.stringify(before) !== JSON.stringify(module)) {
      const commandPatch = sanitizeModulePatch(toModuleSnapshot(module))
      if (Object.keys(commandPatch).length === 0) continue
      const moduleId = module.id
      factories.push((baseRevision) =>
        updateModuleCommand({ baseRevision, moduleId, patch: commandPatch }),
      )
    }
  }

  for (const module of previous.modules) {
    if (typeof module.id === 'string' && module.id.trim() && !nextModules.has(module.id)) {
      const moduleId = module.id
      factories.push((baseRevision) =>
        deleteModuleCommand({ baseRevision, moduleId }),
      )
    }
  }

  const beforeOrder = previous.modules.map((module) => module.id).join('\n')
  const nextOrder = modules.map((module) => module.id).join('\n')
  if (beforeOrder !== nextOrder && modules.every((module) => beforeModules.has(module.id))) {
    const moduleIds = modules.map((module) => module.id)
    factories.push((baseRevision) =>
      reorderModulesCommand({ baseRevision, moduleIds }),
    )
  }

  if (factories.length > 0) {
    runOptimisticCommandSequence(factories, () => restoreModuleState(previous))
  }
}

function dispatchEnabledModulesPatch(
  enabledModules: unknown[],
  previous: ReturnType<typeof currentModuleStateSnapshot>,
  modules: RisuModule[],
): void {
  if (!canUseServerCommands()) return

  const before = new Set(previous.enabledModules)
  const next = new Set(enabledModules.filter((id): id is string => typeof id === 'string'))
  const knownModules = new Set(modules.map((module) => module.id))

  // A4EC2 / B1: serialize enable/disable diffs against one optimistic
  // snapshot. The previous fan-out fired N back-to-back enableModule calls
  // on the same cached baseRevision, racing on response order.
  const factories: Array<(baseRevision: number) => Promise<ServerCommandResult>> = []

  for (const moduleId of next) {
    if (!before.has(moduleId) && knownModules.has(moduleId)) {
      factories.push((baseRevision) =>
        enableModuleCommand({ baseRevision, moduleId, enabled: true }),
      )
    }
  }
  for (const moduleId of before) {
    if (!next.has(moduleId) && knownModules.has(moduleId)) {
      factories.push((baseRevision) =>
        enableModuleCommand({ baseRevision, moduleId, enabled: false }),
      )
    }
  }

  if (factories.length > 0) {
    runOptimisticCommandSequence(factories, () => restoreModuleState(previous))
  }
}

export const getV2PluginAPIs = () => {
  return {
    risuFetch: globalFetch,
    nativeFetch: fetchNative,
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
      const previous = currentCharacterStateSnapshot()
      const previousCharacter = $state.snapshot(DBState.db.characters[charid])
      withTrustedServerProjectionWrite(() => {
        DBState.db.characters[charid] = char
      })
      dispatchCompatibleCharacterUpdate(previousCharacter, char, previous)
    },
    addProvider: (
      name: string,
      func: (
        arg: PluginV2ProviderArgument,
        abortSignal?: AbortSignal,
      ) => Promise<{ success: boolean; content: string }>,
      options?: PluginV2ProviderOptions,
    ) => {
      let provs = get(customProviderStore)
      provs.push(name)
      pluginV2.providers.set(name, func)
      pluginV2.providerOptions.set(name, options ?? {})
      customProviderStore.set(provs)
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
      withTrustedServerProjectionWrite(() => {
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
      if (Object.keys(globalThis.__pluginApis__.safeGlobalThis).length > 0) {
        return globalThis.__pluginApis__.safeGlobalThis
      }
      //safeGlobalThis
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

      safeGlobal.DBState = {
        db: toGetter(globalThis.__pluginApis__.getDatabase),
      }
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
      safeGlobal.navigator = window.navigator
      safeGlobal.localStorage = globalThis.__pluginApis__.safeLocalStorage
      safeGlobal.indexedDB = globalThis.__pluginApis__.safeIdbFactory
      safeGlobal.__pluginApis__ = globalThis.__pluginApis__
      safeGlobal.Object = Object
      safeGlobal.Array = Array
      safeGlobal.String = String
      safeGlobal.Number = Number
      safeGlobal.Boolean = Boolean
      safeGlobal.Math = Math
      safeGlobal.Date = Date
      safeGlobal.RegExp = RegExp
      safeGlobal.Error = Error
      safeGlobal.Function = globalThis.__pluginApis__.SafeFunction
      safeGlobal.document = globalThis.__pluginApis__.safeDocument
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
      const db = DBState?.db
      if (!db) {
        return {}
      }
      return new Proxy(db, {
        get(target, prop) {
          if (typeof prop === 'string' && allowedDbKeys.includes(prop)) {
            return (target as any)[prop]
          } else if (
            typeof prop === 'string' &&
            canUseServerCommands() &&
            unsupportedServerBridgeKeys.has(prop)
          ) {
            return undefined
          } else if (target.pluginCustomStorage) {
            console.log('Getting custom db property', prop.toString())
            return target.pluginCustomStorage[prop.toString()]
          }
          return undefined
        },
        set(target, prop, value) {
          if (typeof prop === 'string' && allowedDbKeys.includes(prop)) {
            if (canUseServerCommands()) {
              applyPluginDatabasePatch({ [prop]: value }, { full: false })
            } else {
              ;(target as any)[prop] = value
            }
            return true
          } else if (
            typeof prop === 'string' &&
            canUseServerCommands() &&
            unsupportedServerBridgeKeys.has(prop)
          ) {
            // Recognized resource family with no bridge command: route through
            // applyPluginDatabasePatch so it is blocked + warned instead of
            // being silently shadowed in plugin storage.
            applyPluginDatabasePatch({ [prop]: value }, { full: false })
            return true
          } else {
            console.log('Setting custom db property', prop.toString(), value)
            setPluginStorageValue(prop.toString(), value)
            return true
          }
        },
        ownKeys(target) {
          const keys = Reflect.ownKeys(target).filter(
            (key) => typeof key === 'string' && allowedDbKeys.includes(key),
          )
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
        const db = getDatabase({ snapshot: true })
        db.pluginCustomStorage ??= {}
        return db.pluginCustomStorage[key] || null
      },
      setItem: (key: string, value: string) => {
        setPluginStorageValue(key, value)
      },
      removeItem: (key: string) => {
        deletePluginStorageValue(key)
      },
      clear: () => {
        replacePluginStorage({})
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
      applyPluginDatabasePatch(newDb, { full: false })
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
      applyPluginDatabasePatch(newDb, { full: true })
    },
    SafeFunction: new Proxy(Function, {
      construct(target, args) {
        return function () {
          return globalThis.__pluginApis__.getSafeGlobalThis()
        }
      },

      //call too
      apply(target, thisArg, args) {
        return function () {
          return globalThis.__pluginApis__.getSafeGlobalThis()
        }
      },
    }),
    loadPlugins: loadPlugins,
    readImage: (path: string) => {
      if (path.startsWith('assets/')) {
        //trim assets/ prefix temporarily
        path = path.slice(7)
      }
      if (path.includes('/') || path.includes('\\')) {
        throw new Error(
          "readImage path cannot contain '/' or '\\' for security reasons, except assets/ prefix.",
        )
      }
      //re-add assets/ prefix
      return readImage('assets/' + path)
    },
    saveAsset: (data: Uint8Array) => {
      // audit:image-default — plugin V2 bridge API has no extension hint;
      // plugins that need an honest extension should use the V3 API which
      // accepts a filename.
      return saveAsset(data)
    },
  }
}

export async function loadV2Plugin(plugins: RisuPlugin[]) {
  if (pluginV2.loaded) {
    for (const unload of pluginV2.unload) {
      await unload()
    }

    pluginV2.providers.clear()
    pluginV2.editdisplay.clear()
    pluginV2.editoutput.clear()
    pluginV2.editprocess.clear()
    pluginV2.editinput.clear()
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
                        const risuFetch = globalThis.__pluginApis__.risuFetch
                        const nativeFetch = globalThis.__pluginApis__.nativeFetch
                        const getArg = globalThis.__pluginApis__.getArg
                        const printLog = globalThis.__pluginApis__.printLog
                        const getChar = globalThis.__pluginApis__.getChar
                        const setChar = globalThis.__pluginApis__.setChar
                        const addProvider = globalThis.__pluginApis__.addProvider
                        const addRisuScriptHandler = globalThis.__pluginApis__.addRisuScriptHandler
                        const removeRisuScriptHandler = globalThis.__pluginApis__.removeRisuScriptHandler
                        const addRisuReplacer = globalThis.__pluginApis__.addRisuReplacer
                        const removeRisuReplacer = globalThis.__pluginApis__.removeRisuReplacer
                        const onUnload = globalThis.__pluginApis__.onUnload
                        const setArg = globalThis.__pluginApis__.setArg
                        const saveAsset = globalThis.__pluginApis__.saveAsset
                        const readImage = globalThis.__pluginApis__.readImage
                        ${
                          version === '2.1'
                            ? `
                            const safeGlobalThis = globalThis.__pluginApis__.getSafeGlobalThis()
                            const Risuai = globalThis.__pluginApis__
                            const safeLocalStorage = globalThis.__pluginApis__.safeLocalStorage
                            const safeIdbFactory = globalThis.__pluginApis__.safeIdbFactory
                            const alertStore = globalThis.__pluginApis__.alertStore
                            const safeDocument = globalThis.__pluginApis__.safeDocument
                            const getDatabase = globalThis.__pluginApis__.getDatabase
                            const setDatabaseLite = globalThis.__pluginApis__.setDatabaseLite
                            const setDatabase = globalThis.__pluginApis__.setDatabase
                            const loadPlugins = globalThis.__pluginApis__.loadPlugins
                            const SafeFunction = globalThis.__pluginApis__.SafeFunction
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
      const safety = await checkCodeSafety(plugin.script)
      data = safety.modifiedCode
      console.log('Safety check result:', safety)
      console.log('Loading V2.1 Plugin', plugin.name, data)

      try {
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
    if (
      !DBState.db.plugins.find(
        (p: RisuPlugin) => p.name === plugin.name && p.script === plugin.script,
      )
    ) {
      if (plugin.version !== '3.0') {
        console.warn(
          `Plugin "${plugin.name}" has version "${plugin.version}", which is not supported for installation via plugin. Only API version 3.0 plugins can be installed via plugin. Skipping installation of this plugin.`,
        )
        continue
      }
      const confirmation = await alertConfirm(
        language.confirmInstallPluginViaPlugin.replace('{plugin}', plugin.name),
      )
      if (confirmation) {
        trimmedPlugins.push(plugin)
      }
    } else {
      console.warn(`Plugin "${plugin.name}" already exists, skipping installation via plugin.`)
    }
  }

  return trimmedPlugins
}
