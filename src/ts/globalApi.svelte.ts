import { checkNullish } from './util'
import { get } from 'svelte/store'
import { type Database, defaultSdDataFunc, getDatabase, appVer, getCurrentCharacter } from './storage/database.svelte'
import { checkRisuUpdate } from './update'
import {
  MobileGUI,
  botMakerMode,
  loadedStore,
  DBState,
  LoadingStatusState,
  selIdState,
  reloadGuiDisplay,
  bodyIntercepterStore,
} from './stores.svelte'
import { loadPlugins } from './plugins/plugins.svelte'
import { alertError, alertMd, alertNormal, alertSelect, alertTOS, waitAlert } from './alert'
import { characterURLImport } from './characterCards'
import { defaultJailbreak, defaultMainPrompt, oldJailbreak, oldMainPrompt } from './storage/defaultPrompts'
import { AutoStorage } from './storage/autoStorage'
import { updateAnimationSpeed } from './gui/animation'
import { updateColorScheme, updateTextThemeAndCSS } from './gui/colorscheme'
import { startObserveDom } from './observer.svelte'
import { updateGuisize } from './gui/guisize'
import { updateLorebooks } from './characters'
import { initMobileGesture } from './hotkey'
import { moduleUpdate } from './process/modules'
import { makeColdData } from './process/coldstorage.svelte'
import { isLocalNetworkUrl } from './network/localNetwork'
import {
  decodeProxyJobWsChunk,
  formatProxyStreamErrorMessage,
  parseProxyJobWsEvent,
  readProxyJobWsBinaryChunk,
} from './network/proxyJobWs'
import { getNodeServerProxyAuth } from './storage/fastifyStorage'
import { activeWriterSessionHeader, handleActiveWriterStaleResponse } from './server/activeWriterSession'
import { setCachedServerCommandRevision } from './server/commands'
import { currentChatSelectionSnapshot, dispatchSelectChat } from './chatCommands'
import {
  readServerAssetBytes,
  serverAssetContentType,
  serverAssetUrl,
  uploadServerAsset,
  SERVER_ASSET_CONTENT_TYPES,
} from './server/assets'
import {
  listServerBackups,
  restoreServerBackup,
  type ServerBackupProgress,
  type ServerBackupProgressCallback,
} from './server/backups'
import { withTrustedServerProjectionWrite } from './server/projectionWriteGuard.svelte'
import { normalizeCharacterOrder } from './characterCommands'

export const forageStorage = new AutoStorage()

interface fetchLog {
  body: string
  header: string
  response: string
  success: boolean
  date: string
  url: string
  responseType?: string
  chatId?: string
  status?: number
}

let fetchLog: fetchLog[] = []

export async function downloadFile(name: string, dat: Uint8Array | ArrayBuffer | string) {
  if (typeof dat === 'string') {
    dat = Buffer.from(dat, 'utf-8')
  }
  const data = new Uint8Array(dat)
  const downloadURL = (data: string, fileName: string) => {
    const a = document.createElement('a')
    a.href = data
    a.download = fileName
    document.body.appendChild(a)
    a.style.display = 'none'
    a.click()
    a.remove()
  }

  const blob = new Blob([data], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)

  downloadURL(url, name)

  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 10000)
}

let fileCache: {
  origin: string[]
  res: (Uint8Array | 'loading' | 'done')[]
} = {
  origin: [],
  res: [],
}

const SERVER_ASSET_BULK_MAX_ITEMS = 32
const SERVER_ASSET_BULK_MAX_RAW_BYTES = 32 * 1024 * 1024
const SERVER_ASSET_BULK_BINARY_CONTENT_TYPE = 'application/vnd.risu.assets-bulk'

export interface AssetSaveInput {
  data: Uint8Array
  customId?: string
  fileName?: string
}

interface PreparedServerAssetUpload {
  assetId: string
  data: Uint8Array
  contentType: string
}

/**
 * Gets the source URL of a file.
 *
 * @param {string} loc - The location of the file.
 * @returns {Promise<string>} - A promise that resolves to the source URL of the file.
 */
export async function getFileSrc(loc: string) {
  // A4EC7 / B8: in Fastify mode the Fastify branch must only return URLs
  // for shapes the server-projection asset gate documents. Unknown shapes
  // (including raw http://https:// values from a poisoned projection) are
  // rejected with an empty string so an <img src=""> renders broken
  // instead of fetching the attacker-controlled origin.
  if (loc.startsWith('/api/v1/assets/') || loc.startsWith('data:') || loc.startsWith('blob:')) {
    return loc
  }
  const resolved = serverAssetUrl(loc)
  return resolved ?? ''
}

/**
 * Reads an image file and returns its data.
 *
 * @param {string} data - The path to the image file.
 * @returns {Promise<Uint8Array>} - A promise that resolves to the data of the image file.
 */
export async function readImage(data: string) {
  return readServerAssetBytes(data)
}

/**
 * Saves an asset file with the given data, custom ID, and file name.
 *
 * @param {Uint8Array} data - The data of the asset file.
 * @param {string} [customId=''] - The custom ID for the asset file.
 * @param {string} [fileName=''] - The name of the asset file.
 * @returns {Promise<string>} - A promise that resolves to the path of the saved asset file.
 */
export async function saveAsset(data: Uint8Array, customId: string = '', fileName: string = '') {
  const fileExtension = assetExtensionFromFileName(fileName)
  return uploadServerAsset(data, fileExtension)
}

export async function saveAssets(assets: readonly AssetSaveInput[]): Promise<string[]> {
  if (assets.length === 0) return []
  const prepared = await Promise.all(
    assets.map(async (asset) => ({
      assetId: await sha256Hex(asset.data),
      data: asset.data,
      contentType: serverAssetContentType(assetExtensionFromFileName(asset.fileName ?? '')),
    })),
  )
  const missingIds = await findMissingServerAssetIds(prepared.map((asset) => asset.assetId))
  const missingUploads: PreparedServerAssetUpload[] = []
  const queuedMissingIds = new Set<string>()
  for (const asset of prepared) {
    if (!missingIds.has(asset.assetId) || queuedMissingIds.has(asset.assetId)) continue
    queuedMissingIds.add(asset.assetId)
    missingUploads.push(asset)
  }

  for (const batch of chunkServerAssetUploads(missingUploads)) {
    const uploadedIds = await uploadServerAssetsBatch(batch)
    for (const [index, uploadedId] of uploadedIds.entries()) {
      const expectedId = batch[index]?.assetId
      if (uploadedId !== expectedId) {
        throw new Error(`Server bulk asset upload returned unexpected asset id: ${uploadedId}`)
      }
    }
  }

  return prepared.map((asset) => asset.assetId)
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Buffer.from(digest).toString('hex')
}

async function findMissingServerAssetIds(assetIds: readonly string[]): Promise<Set<string>> {
  const uniqueAssetIds = [...new Set(assetIds)]
  if (uniqueAssetIds.length === 0) return new Set()
  const response = await fetch('/api/v1/assets/exists', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ids: uniqueAssetIds }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(body || `Failed to check server assets: ${response.status}`)
  }
  const responseBody = (await response.json()) as { missing?: unknown }
  if (!Array.isArray(responseBody.missing)) {
    throw new Error('Server asset exists response has invalid missing ids')
  }
  const missing = new Set<string>()
  for (const [index, id] of responseBody.missing.entries()) {
    if (typeof id !== 'string') {
      throw new Error(`Server asset exists response missing[${index}] is invalid`)
    }
    missing.add(id)
  }
  return missing
}

function assetExtensionFromFileName(fileName: string): string {
  let fileExtension = 'png'
  if (fileName && fileName.split('.').length > 0) {
    fileExtension = fileName.split('.').pop()?.toLowerCase() ?? 'png'
  }
  return fileExtension
}

function chunkServerAssetUploads(assets: readonly PreparedServerAssetUpload[]): PreparedServerAssetUpload[][] {
  const chunks: PreparedServerAssetUpload[][] = []
  let chunk: PreparedServerAssetUpload[] = []
  let chunkBytes = 0
  const flush = () => {
    if (chunk.length === 0) return
    chunks.push(chunk)
    chunk = []
    chunkBytes = 0
  }

  for (const asset of assets) {
    if (
      chunk.length > 0 &&
      (chunk.length >= SERVER_ASSET_BULK_MAX_ITEMS ||
        chunkBytes + asset.data.byteLength > SERVER_ASSET_BULK_MAX_RAW_BYTES)
    ) {
      flush()
    }
    chunk.push(asset)
    chunkBytes += asset.data.byteLength
  }
  flush()
  return chunks
}

async function uploadServerAssetsBatch(assets: readonly PreparedServerAssetUpload[]): Promise<string[]> {
  if (assets.length === 0) return []
  if (assets.length === 1) {
    const [asset] = assets
    const extension =
      Object.entries(SERVER_ASSET_CONTENT_TYPES).find(([, contentType]) => {
        return contentType === asset.contentType
      })?.[0] ?? 'png'
    return [await uploadServerAsset(asset.data, extension)]
  }

  const auth = await getNodeServerProxyAuth()
  const response = await fetch('/api/v1/assets/bulk', {
    method: 'POST',
    headers: {
      'content-type': SERVER_ASSET_BULK_BINARY_CONTENT_TYPE,
      'risu-auth': auth,
      ...activeWriterSessionHeader(),
    },
    body: buildServerAssetBulkBinaryBody(assets),
  })

  if (response.status === 413 && assets.length > 1) {
    const midpoint = Math.ceil(assets.length / 2)
    return [
      ...(await uploadServerAssetsBatch(assets.slice(0, midpoint))),
      ...(await uploadServerAssetsBatch(assets.slice(midpoint))),
    ]
  }

  if (!response.ok) {
    handleActiveWriterStaleResponse(response)
    const body = await response.text().catch(() => '')
    throw new Error(body || `Failed to upload server assets: ${response.status}`)
  }

  const responseBody = (await response.json()) as {
    assets?: unknown
    revision?: unknown
  }
  if (!Array.isArray(responseBody.assets) || responseBody.assets.length !== assets.length) {
    throw new Error('Server bulk asset upload response has invalid assets')
  }
  advanceServerAssetRevision(responseBody.revision)
  return responseBody.assets.map((asset, index) => {
    if (!asset || typeof asset !== 'object') {
      throw new Error(`Server bulk asset upload response asset[${index}] is invalid`)
    }
    const assetId = (asset as { assetId?: unknown }).assetId
    if (typeof assetId !== 'string') {
      throw new Error(`Server bulk asset upload response asset[${index}] missing assetId`)
    }
    const revision = (asset as { revision?: unknown }).revision
    advanceServerAssetRevision(revision)
    return assetId
  })
}

function buildServerAssetBulkBinaryBody(assets: readonly PreparedServerAssetUpload[]): ArrayBuffer {
  const manifestBytes = new TextEncoder().encode(
    JSON.stringify({
      assets: assets.map((asset) => ({
        contentType: asset.contentType,
        size: asset.data.byteLength,
      })),
    }),
  )
  const bodyLength = 4 + manifestBytes.byteLength + assets.reduce((total, asset) => total + asset.data.byteLength, 0)
  const body = new Uint8Array(bodyLength)
  new DataView(body.buffer).setUint32(0, manifestBytes.byteLength)
  body.set(manifestBytes, 4)
  let offset = 4 + manifestBytes.byteLength
  for (const asset of assets) {
    body.set(asset.data, offset)
    offset += asset.data.byteLength
  }
  return body.buffer
}

function advanceServerAssetRevision(revision: unknown): void {
  // A new asset bumps the repository revision; advance the cached command
  // revision so the next command does not race on a stale baseRevision.
  if (typeof revision === 'number') {
    setCachedServerCommandRevision(revision)
  }
}

/**
 * Loads an asset file with the given ID.
 *
 * @param {string} id - The ID of the asset file to load.
 * @returns {Promise<Uint8Array>} - A promise that resolves to the data of the loaded asset file.
 */
export async function loadAsset(id: string) {
  return readServerAssetBytes(id)
}

let lastSave = ''
export let saving = $state({
  state: false,
})

/**
 * Saves the current state of the database.
 *
 * @returns {Promise<void>} - A promise that resolves when the database has been saved.
 */
export let requiresFullEncoderReload = $state({
  state: false,
})
export async function saveDb() {
  return
}

/**
 * Retrieves the database backups.
 *
 * @returns {Promise<number[]>} - A promise that resolves to an array of backup timestamps.
 */
export async function getDbBackups() {
  return []
}

/**
 * Retrieves fetch data for a given chat ID.
 *
 * @param {string} id - The chat ID to search for in the fetch log.
 * @returns {fetchLog | null} - The fetch log entry if found, otherwise null.
 */
export function getFetchData(id: string) {
  for (const log of fetchLog) {
    if (log.chatId === id) {
      return log
    }
  }
  return null
}

const knownHostes = ['localhost', '127.0.0.1', '0.0.0.0']
const defaultProxyJobHeartbeatSec = 15

function getProxyFetchUrl() {
  return '/api/v1/proxy/fetch'
}

function getProxyStreamJobsCreateUrl() {
  return '/api/v1/proxy/stream-jobs'
}

function getProxyStreamJobDeleteUrl(jobId: string) {
  const enc = encodeURIComponent(jobId)
  return `/api/v1/proxy/stream-jobs/${enc}`
}

function getProxyStreamJobWsPath(jobId: string) {
  const enc = encodeURIComponent(jobId)
  return `/api/v1/proxy/stream-jobs/${enc}/ws`
}

function buildTimeoutSignal(originalSignal?: AbortSignal, timeoutMs?: number) {
  if (!timeoutMs || timeoutMs <= 0) {
    return {
      signal: originalSignal,
      cleanup: () => {
        /* no-op */
      },
    }
  }

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (originalSignal) {
    if (originalSignal.aborted) {
      controller.abort()
    } else {
      originalSignal.addEventListener('abort', onAbort, { once: true })
    }
  }

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId)
      originalSignal?.removeEventListener('abort', onAbort)
    },
  }
}

/**
 * Interface representing the arguments for the global fetch function.
 *
 * @interface GlobalFetchArgs
 * @property {boolean} [plainFetchForce] - Whether to force plain fetch.
 * @property {any} [body] - The body of the request.
 * @property {{ [key: string]: string }} [headers] - The headers of the request.
 * @property {boolean} [rawResponse] - Whether to return the raw response.
 * @property {'POST' | 'GET'} [method] - The HTTP method to use.
 * @property {AbortSignal} [abortSignal] - The abort signal to cancel the request.
 * @property {boolean} [useRisuToken] - Whether to use the Risu token.
 * @property {string} [chatId] - The chat ID associated with the request.
 */
export interface GlobalFetchArgs {
  plainFetchForce?: boolean
  plainFetchDeforce?: boolean
  body?: any
  headers?: { [key: string]: string }
  rawResponse?: boolean
  method?: 'POST' | 'GET'
  abortSignal?: AbortSignal
  useRisuToken?: boolean
  chatId?: string
  interceptor?: string
  requestTimeoutMs?: number
  networkRoute?: 'auto' | 'local_network'
}

/**
 * Interface representing the result of the global fetch function.
 *
 * @interface GlobalFetchResult
 * @property {boolean} ok - Whether the request was successful.
 * @property {any} data - The data returned from the request.
 * @property {{ [key: string]: string }} headers - The headers returned from the request.
 */
interface GlobalFetchResult {
  ok: boolean
  data: any
  headers: { [key: string]: string }
  status: number
}

/**
 * Adds a fetch log entry.
 *
 * @param {Object} arg - The arguments for the fetch log entry.
 * @param {any} arg.body - The body of the request.
 * @param {{ [key: string]: string }} [arg.headers] - The headers of the request.
 * @param {any} arg.response - The response from the request.
 * @param {boolean} arg.success - Whether the request was successful.
 * @param {string} arg.url - The URL of the request.
 * @param {string} [arg.resType] - The response type.
 * @param {string} [arg.chatId] - The chat ID associated with the request.
 * @returns {number} - The index of the added fetch log entry.
 */
export function addFetchLog(arg: {
  body: any
  headers?: { [key: string]: string }
  response: any
  success: boolean
  url: string
  resType?: string
  chatId?: string
  status?: number
}): number {
  fetchLog.unshift({
    body: typeof arg.body === 'string' ? arg.body : JSON.stringify(arg.body, null, 2),
    header: JSON.stringify(arg.headers ?? {}, null, 2),
    response: typeof arg.response === 'string' ? arg.response : JSON.stringify(arg.response, null, 2),
    responseType: arg.resType ?? 'json',
    success: arg.success,
    date: new Date().toLocaleTimeString(),
    url: arg.url,
    chatId: arg.chatId,
    status: arg.status,
  })
  return 0
}

/**
 * Performs a global fetch request.
 *
 * @param {string} url - The URL to fetch.
 * @param {GlobalFetchArgs} [arg={}] - The arguments for the fetch request.
 * @returns {Promise<GlobalFetchResult>} - The result of the fetch request.
 */
export async function globalFetch(url: string, arg: GlobalFetchArgs = {}): Promise<GlobalFetchResult> {
  try {
    const db = getDatabase()
    if (arg.abortSignal?.aborted) {
      return { ok: false, data: 'aborted', headers: {}, status: 400 }
    }

    const urlHost = new URL(url).hostname
    const useLocalNetworkRoute = arg.networkRoute === 'local_network' && isLocalNetworkUrl(url)
    const forcePlainFetch =
      (knownHostes.includes(urlHost) || db.usePlainFetch || arg.plainFetchForce) &&
      !arg.plainFetchDeforce &&
      !useLocalNetworkRoute

    if (arg.interceptor) {
      for (const interceptor of bodyIntercepterStore) {
        try {
          arg.body = (await interceptor.callback(arg.body, arg.interceptor)) || arg.body
        } catch (e) {
          console.error(e)
        }
      }
    }

    const timeoutSignal = buildTimeoutSignal(arg.abortSignal, arg.requestTimeoutMs)
    const requestArg = timeoutSignal.signal === arg.abortSignal ? arg : { ...arg, abortSignal: timeoutSignal.signal }

    try {
      if (useLocalNetworkRoute) {
        return await fetchWithProxy(url, requestArg)
      }
      if (forcePlainFetch) {
        return await fetchWithPlainFetch(url, requestArg)
      }
      //userScriptFetch is provided by userscript
      if (window.userScriptFetch) {
        return await fetchWithUSFetch(url, requestArg)
      }
      return await fetchWithProxy(url, requestArg)
    } finally {
      timeoutSignal.cleanup()
    }
  } catch (error) {
    console.error(error)
    return { ok: false, data: `${error}`, headers: {}, status: 400 }
  }
}

/**
 * Adds a fetch log entry in the global fetch log.
 *
 * @param {any} response - The response data.
 * @param {boolean} success - Indicates if the fetch was successful.
 * @param {string} url - The URL of the fetch request.
 * @param {GlobalFetchArgs} arg - The arguments for the fetch request.
 */
function addFetchLogInGlobalFetch(response: any, success: boolean, url: string, arg: GlobalFetchArgs, status?: number) {
  try {
    fetchLog.unshift({
      body: JSON.stringify(arg.body, null, 2),
      header: JSON.stringify(arg.headers ?? {}, null, 2),
      response: JSON.stringify(response, null, 2),
      success: success,
      date: new Date().toLocaleTimeString(),
      url: url,
      chatId: arg.chatId,
      status: status,
    })
  } catch {
    fetchLog.unshift({
      body: JSON.stringify(arg.body, null, 2),
      header: JSON.stringify(arg.headers ?? {}, null, 2),
      response: `${response}`,
      success: success,
      date: new Date().toLocaleTimeString(),
      url: url,
      chatId: arg.chatId,
      status: status,
    })
  }

  if (fetchLog.length > 20) {
    fetchLog.pop()
  }
}

/**
 * Performs a fetch request using plain fetch.
 *
 * @param {string} url - The URL to fetch.
 * @param {GlobalFetchArgs} arg - The arguments for the fetch request.
 * @returns {Promise<GlobalFetchResult>} - The result of the fetch request.
 */
async function fetchWithPlainFetch(url: string, arg: GlobalFetchArgs): Promise<GlobalFetchResult> {
  try {
    const headers = { 'Content-Type': 'application/json', ...arg.headers }
    const response = await fetch(new URL(url), {
      body: JSON.stringify(arg.body),
      headers,
      method: arg.method ?? 'POST',
      signal: arg.abortSignal,
    })
    const data = arg.rawResponse ? new Uint8Array(await response.arrayBuffer()) : await response.json()
    const ok = response.ok && response.status >= 200 && response.status < 300
    addFetchLogInGlobalFetch(data, ok, url, arg, response.status)
    return { ok, data, headers: Object.fromEntries(response.headers), status: response.status }
  } catch (error) {
    return { ok: false, data: `${error}`, headers: {}, status: 400 }
  }
}

/**
 * Performs a fetch request using userscript provided fetch.
 *
 * @param {string} url - The URL to fetch.
 * @param {GlobalFetchArgs} arg - The arguments for the fetch request.
 * @returns {Promise<GlobalFetchResult>} - The result of the fetch request.
 */
async function fetchWithUSFetch(url: string, arg: GlobalFetchArgs): Promise<GlobalFetchResult> {
  try {
    const headers = { 'Content-Type': 'application/json', ...arg.headers }
    const response = await userScriptFetch(url, {
      body: JSON.stringify(arg.body),
      headers,
      method: arg.method ?? 'POST',
      signal: arg.abortSignal,
    })
    const data = arg.rawResponse ? new Uint8Array(await response.arrayBuffer()) : await response.json()
    const ok = response.ok && response.status >= 200 && response.status < 300
    addFetchLogInGlobalFetch(data, ok, url, arg, response.status)
    return { ok, data, headers: Object.fromEntries(response.headers), status: response.status }
  } catch (error) {
    return { ok: false, data: `${error}`, headers: {}, status: 400 }
  }
}

/**
 * Performs a fetch request using a proxy.
 *
 * @param {string} url - The URL to fetch.
 * @param {GlobalFetchArgs} arg - The arguments for the fetch request.
 * @returns {Promise<GlobalFetchResult>} - The result of the fetch request.
 */
async function fetchWithProxy(url: string, arg: GlobalFetchArgs): Promise<GlobalFetchResult> {
  try {
    const furl = getProxyFetchUrl()
    arg.headers ??= {}
    arg.headers['Content-Type'] ??=
      arg.body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : 'application/json'
    const nodeProxyAuth = await getNodeServerProxyAuth()
    const headers = {
      'risu-header': encodeURIComponent(JSON.stringify(arg.headers)),
      'risu-url': encodeURIComponent(url),
      'Content-Type': arg.body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : 'application/json',
      ...(arg.useRisuToken && { 'x-risu-tk': 'use' }),
      ...(arg.requestTimeoutMs && {
        'risu-timeout-ms': Math.max(1, Math.floor(arg.requestTimeoutMs)).toString(),
      }),
      ...(nodeProxyAuth && { 'risu-auth': nodeProxyAuth }),
      ...(DBState?.db?.requestLocation && { 'risu-location': DBState.db.requestLocation }),
    }

    const body = arg.body instanceof URLSearchParams ? arg.body.toString() : JSON.stringify(arg.body)

    const response = await fetch(furl, {
      body,
      headers,
      method: arg.method ?? 'POST',
      signal: arg.abortSignal,
    })
    const isSuccess = response.ok && response.status >= 200 && response.status < 300

    if (arg.rawResponse) {
      const data = new Uint8Array(await response.arrayBuffer())
      addFetchLogInGlobalFetch('Uint8Array Response', isSuccess, url, arg, response.status)
      return {
        ok: isSuccess,
        data,
        headers: Object.fromEntries(response.headers),
        status: response.status,
      }
    }

    const text = await response.text()
    try {
      const data = JSON.parse(text)
      addFetchLogInGlobalFetch(data, isSuccess, url, arg, response.status)
      return {
        ok: isSuccess,
        data,
        headers: Object.fromEntries(response.headers),
        status: response.status,
      }
    } catch (error) {
      const errorMsg = text.startsWith('<!DOCTYPE')
        ? 'Responded HTML. Is your URL, API key, and password correct?'
        : text
      addFetchLogInGlobalFetch(text, false, url, arg, response.status)
      return {
        ok: false,
        data: errorMsg,
        headers: Object.fromEntries(response.headers),
        status: response.status,
      }
    }
  } catch (error) {
    return { ok: false, data: `${error}`, headers: {}, status: 400 }
  }
}

/**
 * Regular expression to match backslashes.
 *
 * @constant {RegExp}
 */
const re = /\\/g

/**
 * Gets the basename of a given path.
 *
 * @param {string} data - The path to get the basename from.
 * @returns {string} - The basename of the path.
 */
export function getBasename(data: string) {
  const splited = data.replace(re, '/').split('/')
  const lasts = splited[splited.length - 1]
  return lasts
}

/**
 * Replaces database resources with the provided replacer object.
 *
 * @param {Database} db - The database object containing resources to be replaced.
 * @param {{[key: string]: string}} replacer - An object mapping original resource keys to their replacements.
 * @returns {Database} - The updated database object with replaced resources.
 */
export function replaceDbResources(db: Database, replacer: { [key: string]: string }): Database {
  /**
   * Replaces a given data string with its corresponding value from the replacer object.
   *
   * @param {string} data - The data string to be replaced.
   * @returns {string} - The replaced data string or the original data if no replacement is found.
   */
  function replaceData(data: string): string {
    if (!data) {
      return data
    }
    return replacer[data] ?? data
  }

  db.customBackground = replaceData(db.customBackground)
  db.userIcon = replaceData(db.userIcon)

  for (const cha of db.characters) {
    if (cha.image) {
      cha.image = replaceData(cha.image)
    }
    if (cha.emotionImages) {
      for (let i = 0; i < cha.emotionImages.length; i++) {
        cha.emotionImages[i][1] = replaceData(cha.emotionImages[i][1])
      }
    }
    if (cha.additionalAssets) {
      for (let i = 0; i < cha.additionalAssets.length; i++) {
        cha.additionalAssets[i][1] = replaceData(cha.additionalAssets[i][1])
      }
    }
  }
  return db
}

/**
 * Legacy compatibility hook for read/bootstrap paths.
 *
 * Fastify bootstrap and character commands own durable character-order
 * normalization. This helper intentionally computes the repair shape without
 * mutating projection; mutation flows that need an immediate optimistic repair
 * call characterCommands.repairCharacterOrderOptimistically().
 */
export function checkCharOrder() {
  return !normalizeCharacterOrder(DBState.db.characterOrder, DBState.db.characters).changed
}

/**
 * Retrieves the request log as a formatted string.
 *
 * @returns {string} The formatted request log.
 */
export function getRequestLog() {
  let logString = ''
  const b = '\n\`\`\`json\n'
  const bend = '\n\`\`\`\n'

  for (const log of fetchLog) {
    logString +=
      `## ${log.date}\n\n* Request URL\n\n${b}${log.url}${bend}\n\n* Request Body\n\n${b}${log.body}${bend}\n\n* Request Header\n\n${b}${log.header}${bend}\n\n` +
      `* Response Body\n\n${b}${log.response}${bend}\n\n* Response Success\n\n${b}${log.success}${bend}\n\n`
  }
  return logString
}

/**
 * Retrieves the fetch logs array.
 *
 * @returns {fetchLog[]} The fetch logs array.
 */
export function getFetchLogs() {
  return fetchLog
}

/**
 * Opens a URL in the appropriate environment.
 *
 * @param {string} url - The URL to open.
 */
export function openURL(url: string) {
  window.open(url, '_blank')
}

/**
 * Converts FormData to a URL-encoded string.
 *
 * @param {FormData} formData - The FormData to convert.
 * @returns {string} The URL-encoded string.
 */
function formDataToString(formData: FormData): string {
  const params: string[] = []

  for (const [name, value] of formData.entries()) {
    params.push(`${encodeURIComponent(name)}=${encodeURIComponent(value.toString())}`)
  }

  return params.join('&')
}

/**
 * Class representing a local writer.
 */
export class LocalWriter {
  writer: WritableStreamDefaultWriter

  /**
   * Initializes the writer.
   *
   * @param {string} [name='Binary'] - The name of the file.
   * @param {string[]} [ext=['bin']] - The file extensions.
   * @returns {Promise<boolean>} - A promise that resolves to a boolean indicating success.
   */
  async init(name = 'Binary', ext = ['bin']): Promise<boolean> {
    const streamSaver = await import('streamsaver')
    const writableStream = streamSaver.createWriteStream(name + '.' + ext[0])
    this.writer = writableStream.getWriter()
    return true
  }

  /**
   * Writes backup data to the file.
   *
   * @param {string} name - The name of the backup.
   * @param {Uint8Array} data - The data to write.
   */
  async writeBackup(name: string, data: Uint8Array): Promise<void> {
    const encodedName = new TextEncoder().encode(getBasename(name))
    const nameLength = new Uint32Array([encodedName.byteLength])
    await this.writer.write(new Uint8Array(nameLength.buffer))
    await this.writer.write(encodedName)
    const dataLength = new Uint32Array([data.byteLength])
    await this.writer.write(new Uint8Array(dataLength.buffer))
    await this.writer.write(data)
  }

  /**
   * Writes data to the file.
   *
   * @param {Uint8Array} data - The data to write.
   */
  async write(data: Uint8Array): Promise<void> {
    await this.writer.write(data)
  }

  /**
   * Closes the writer.
   */
  async close(): Promise<void> {
    await this.writer.close()
  }
}

/**
 * Class representing a virtual writer.
 */
export class VirtualWriter {
  buf = new AppendableBuffer()

  /**
   * Writes data to the buffer.
   *
   * @param {Uint8Array} data - The data to write.
   */
  write(data: Uint8Array): void {
    this.buf.append(data)
  }

  /**
   * Closes the writer. (No operation for VirtualWriter)
   */
  close(): void {
    // do nothing
  }
}

/**
 * A class to manage a buffer that can be appended to and deappended from.
 */
export class AppendableBuffer {
  deapended: number = 0
  #buffer: Uint8Array
  #byteLength: number = 0

  /**
   * Creates an instance of AppendableBuffer.
   */
  constructor() {
    this.#buffer = new Uint8Array(128)
  }

  get buffer(): Uint8Array {
    return this.#buffer.slice(0, this.#byteLength)
  }

  /**
   * Appends data to the buffer.
   * @param {Uint8Array} data - The data to append.
   */
  append(data: Uint8Array) {
    // New way (faster)
    const requiredLength = this.#byteLength + data.length
    if (this.#buffer.byteLength < requiredLength) {
      let newLength = this.#buffer.byteLength * 2
      while (newLength < requiredLength) {
        newLength *= 2
      }
      const newBuffer = new Uint8Array(newLength)
      newBuffer.set(this.#buffer)
      this.#buffer = newBuffer
    }
    this.#buffer.set(data, this.#byteLength)
    this.#byteLength += data.length
  }

  /**
   * Deappends a specified length from the buffer.
   * @param {number} length - The length to deappend.
   */
  deappend(length: number) {
    this.#buffer = this.#buffer.slice(length)
    this.deapended += length
    this.#byteLength -= length
  }

  /**
   * Slices the buffer from start to end.
   * @param {number} start - The start index.
   * @param {number} end - The end index.
   * @returns {Uint8Array} - The sliced buffer.
   */
  slice(start: number, end: number) {
    return this.buffer.slice(start - this.deapended, end - this.deapended)
  }

  /**
   * Gets the total length of the buffer including deappended length.
   * @returns {number} - The total length.
   */
  length() {
    return this.#byteLength + this.deapended
  }

  /**
   * Clears the buffer.
   */
  clear() {
    this.#buffer = new Uint8Array(128)
    this.#byteLength = 0
    this.deapended = 0
  }
}

/**
 * Pipes the fetch log to a readable stream.
 * @param {number} fetchLogIndex - The index of the fetch log.
 * @param {ReadableStream<Uint8Array>} readableStream - The readable stream to pipe.
 * @returns {ReadableStream<Uint8Array>} - The new readable stream.
 */
const pipeFetchLog = (fetchLogIndex: number, readableStream: ReadableStream<Uint8Array>) => {
  const splited = readableStream.tee()

  ;(async () => {
    const text = await new Response(splited[0]).text()
    fetchLog[fetchLogIndex].response = text
  })()

  return splited[1]
}

async function fetchViaProxyJobWs(
  url: string,
  arg: {
    body: Uint8Array
    headers?: { [key: string]: string }
    method: 'POST' | 'GET' | 'PUT' | 'DELETE'
    signal?: AbortSignal
    requestTimeoutMs?: number
    chatId?: string
    fetchLogIndex: number
  },
): Promise<Response> {
  const auth = await getNodeServerProxyAuth()

  const requestSignal = arg.signal

  let jobId = ''
  const createRes = await fetch(getProxyStreamJobsCreateUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'risu-auth': auth,
    },
    body: JSON.stringify({
      url,
      method: arg.method,
      headers: arg.headers ?? {},
      bodyBase64: Buffer.from(arg.body).toString('base64'),
      timeoutMs: arg.requestTimeoutMs,
      heartbeatSec: defaultProxyJobHeartbeatSec,
    }),
    signal: requestSignal,
  })

  if (!createRes.ok) {
    const errText = await createRes.text()
    throw new Error(`Proxy stream job creation failed: ${createRes.status} ${errText}`)
  }

  const created = (await createRes.json()) as { jobId?: string }
  if (!created.jobId) {
    throw new Error('Proxy stream job creation returned no jobId')
  }
  jobId = created.jobId

  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${wsProtocol}//${location.host}${getProxyStreamJobWsPath(jobId)}?risu-auth=${encodeURIComponent(auth)}`

  let headersReady = false
  let status = 200
  let responseHeaders: HeadersInit = { 'content-type': 'text/event-stream' }
  let settled = false
  let resolveHeaders: () => void = () => {}
  const waitHeaders = new Promise<void>((resolve) => {
    resolveHeaders = resolve
  })
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
  const encoder = new TextEncoder()

  const ws = new WebSocket(wsUrl)
  ws.binaryType = 'arraybuffer'
  let terminalProxyFrameSeen = false
  let localRequestAborted = false
  let cancelDeleteSent = false
  let abortListenerAttached = false
  let abortHandler: () => void = () => {}

  const detachAbortListener = () => {
    if (!abortListenerAttached) {
      return
    }
    abortListenerAttached = false
    requestSignal?.removeEventListener('abort', abortHandler)
  }

  const deleteProxyJobOnce = () => {
    if (cancelDeleteSent || !jobId) {
      return
    }
    cancelDeleteSent = true
    void fetch(getProxyStreamJobDeleteUrl(jobId), {
      method: 'DELETE',
      headers: {
        'risu-auth': auth,
      },
    }).catch(() => {})
  }

  const closeAndEnd = () => {
    if (settled) {
      return
    }
    settled = true
    detachAbortListener()
    if (localRequestAborted && !terminalProxyFrameSeen) {
      deleteProxyJobOnce()
    }
    if (streamController) {
      try {
        streamController.close()
      } catch {
        // no-op
      }
    }
    try {
      ws.close()
    } catch {
      // no-op
    }
  }

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
    },
    cancel() {
      closeAndEnd()
    },
  })
  const pipedReadable = pipeFetchLog(arg.fetchLogIndex, readable)

  const ensureHeadersReady = () => {
    if (!headersReady) {
      headersReady = true
      resolveHeaders()
    }
  }

  ws.onmessage = (event) => {
    const binaryChunk = readProxyJobWsBinaryChunk(event.data)
    if (binaryChunk) {
      ensureHeadersReady()
      streamController?.enqueue(binaryChunk)
      return
    }
    const parsed = parseProxyJobWsEvent(typeof event.data === 'string' ? event.data : '')
    if (!parsed || !streamController) {
      return
    }
    switch (parsed.type) {
      case 'job_accepted':
      case 'ping':
        return
      case 'upstream_headers':
        status = parsed.status
        responseHeaders = parsed.headers ?? {}
        ensureHeadersReady()
        return
      case 'chunk':
        ensureHeadersReady()
        streamController.enqueue(decodeProxyJobWsChunk(parsed.dataBase64))
        return
      case 'error': {
        terminalProxyFrameSeen = true
        status = parsed.status ?? 502
        responseHeaders = { 'content-type': 'text/plain; charset=utf-8' }
        ensureHeadersReady()
        const msg = formatProxyStreamErrorMessage(parsed.status, parsed.message)
        streamController.enqueue(encoder.encode(msg))
        closeAndEnd()
        return
      }
      case 'done':
        terminalProxyFrameSeen = true
        ensureHeadersReady()
        closeAndEnd()
        return
    }
  }

  ws.onerror = () => {
    if (!streamController) {
      return
    }
    status = 502
    responseHeaders = { 'content-type': 'text/plain; charset=utf-8' }
    ensureHeadersReady()
    streamController.enqueue(encoder.encode('Proxy WebSocket stream error'))
    closeAndEnd()
  }

  ws.onclose = () => {
    if (!headersReady) {
      status = 502
      responseHeaders = { 'content-type': 'text/plain; charset=utf-8' }
      ensureHeadersReady()
    }
    closeAndEnd()
  }

  abortHandler = () => {
    localRequestAborted = true
    status = 499
    responseHeaders = { 'content-type': 'text/plain; charset=utf-8' }
    ensureHeadersReady()
    if (streamController && !settled) {
      streamController.enqueue(encoder.encode('Aborted'))
    }
    closeAndEnd()
  }
  if (requestSignal?.aborted) {
    abortHandler()
  } else {
    requestSignal?.addEventListener('abort', abortHandler)
    abortListenerAttached = !!requestSignal
  }

  await waitHeaders
  return new Response(pipedReadable, {
    status,
    headers: new Headers(responseHeaders),
  })
}

/**
 * Fetches data from a given URL using native fetch or through a proxy.
 * @param {string} url - The URL to fetch data from.
 * @param {Object} arg - The arguments for the fetch request.
 * @param {string} arg.body - The body of the request.
 * @param {Object} [arg.headers] - The headers of the request.
 * @param {string} [arg.method="POST"] - The HTTP method of the request.
 * @param {AbortSignal} [arg.signal] - The signal to abort the request.
 * @param {boolean} [arg.useRisuTk] - Whether to use Risu token.
 * @param {string} [arg.chatId] - The chat ID associated with the request.
 * @returns {Promise<Object>} - A promise that resolves to an object containing the response body, headers, and status.
 * @returns {ReadableStream<Uint8Array>} body - The response body as a readable stream.
 * @returns {Headers} headers - The response headers.
 * @returns {number} status - The response status code.
 * @throws {Error} - Throws an error if the request is aborted or if there is an error in the response.
 */
export async function fetchNative(
  url: string,
  arg: {
    body?: string | Uint8Array | ArrayBuffer
    headers?: { [key: string]: string }
    method?: 'POST' | 'GET' | 'PUT' | 'DELETE'
    signal?: AbortSignal
    useRisuTk?: boolean
    chatId?: string
    interceptor?: string
    requestTimeoutMs?: number
    networkRoute?: 'auto' | 'local_network'
  },
): Promise<Response> {
  const useInterceptor = !!arg.interceptor
  if (arg.body === undefined && (arg.method === 'POST' || arg.method === 'PUT')) {
    throw new Error('Body is required for POST and PUT requests')
  }

  arg.method = arg.method ?? 'POST'

  let headers = arg.headers ?? {}
  let realBody: Uint8Array

  if (arg.method === 'GET' || arg.method === 'DELETE') {
    realBody = undefined
  } else if (typeof arg.body === 'string') {
    let body: string = arg.body
    if (useInterceptor) {
      for (const interceptor of bodyIntercepterStore) {
        try {
          body = (await interceptor.callback(body, arg.interceptor)) || body
        } catch (e) {
          console.error(e)
        }
      }
    }
    realBody = new TextEncoder().encode(body)
  } else if (arg.body instanceof Uint8Array) {
    realBody = arg.body
  } else if (arg.body instanceof ArrayBuffer) {
    realBody = new Uint8Array(arg.body)
  } else {
    throw new Error('Invalid body type')
  }

  const useLocalNetworkRoute = arg.networkRoute === 'local_network' && isLocalNetworkUrl(url)
  const throughProxy = useLocalNetworkRoute
  const timeoutSignal = buildTimeoutSignal(arg.signal, arg.requestTimeoutMs)
  const requestSignal = timeoutSignal.signal
  let fetchLogIndex = addFetchLog({
    body: new TextDecoder().decode(realBody),
    headers: arg.headers,
    response: 'Streamed Fetch',
    success: true,
    url: url,
    resType: 'stream',
    chatId: arg.chatId,
  })
  try {
    if (window.userScriptFetch && !throughProxy) {
      return await window.userScriptFetch(url, {
        body: realBody as any,
        headers: headers,
        method: arg.method,
        signal: requestSignal,
      })
    } else if (throughProxy) {
      const useProxyJobWs = arg.interceptor === 'openai_streaming' && arg.method === 'POST' && useLocalNetworkRoute
      const nodeProxyAuth = await getNodeServerProxyAuth()

      if (useProxyJobWs) {
        try {
          return await fetchViaProxyJobWs(url, {
            body: realBody,
            headers,
            method: arg.method,
            signal: requestSignal,
            requestTimeoutMs: arg.requestTimeoutMs,
            chatId: arg.chatId,
            fetchLogIndex,
          })
        } catch (wsErr) {
          console.warn('[ProxyJobWS] falling back to Fastify proxy fetch due to error:', wsErr)
        }
      }

      const r = await fetch(getProxyFetchUrl(), {
        body: realBody as any,
        headers: arg.useRisuTk
          ? {
              'risu-header': encodeURIComponent(JSON.stringify(headers)),
              'risu-url': encodeURIComponent(url),
              'Content-Type': 'application/json',
              'x-risu-tk': 'use',
              ...(arg.requestTimeoutMs && {
                'risu-timeout-ms': Math.max(1, Math.floor(arg.requestTimeoutMs)).toString(),
              }),
              ...(nodeProxyAuth ? { 'risu-auth': nodeProxyAuth } : {}),
              ...(DBState?.db?.requestLocation && { 'risu-location': DBState.db.requestLocation }),
            }
          : {
              'risu-header': encodeURIComponent(JSON.stringify(headers)),
              'risu-url': encodeURIComponent(url),
              'Content-Type': 'application/json',
              ...(arg.requestTimeoutMs && {
                'risu-timeout-ms': Math.max(1, Math.floor(arg.requestTimeoutMs)).toString(),
              }),
              ...(nodeProxyAuth ? { 'risu-auth': nodeProxyAuth } : {}),
              ...(DBState?.db?.requestLocation && { 'risu-location': DBState.db.requestLocation }),
            },
        method: arg.method,
        signal: requestSignal,
      })

      return new Response(r.body, {
        headers: r.headers,
        status: r.status,
      })
    } else {
      return await fetch(url, {
        body: realBody as any,
        headers: headers,
        method: arg.method,
        signal: requestSignal,
      })
    }
  } finally {
    timeoutSignal.cleanup()
  }
}

/**
 * Converts a ReadableStream of Uint8Array to a text string.
 *
 * @param {ReadableStream<Uint8Array>} stream - The readable stream to convert.
 * @returns {Promise<string>} A promise that resolves to the text content of the stream.
 */
export function textifyReadableStream(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text()
}

/**
 * Toggles the fullscreen mode of the document.
 * If the document is currently in fullscreen mode, it exits fullscreen.
 * If the document is not in fullscreen mode, it requests fullscreen with navigation UI hidden.
 */
export function toggleFullscreen() {
  const fullscreenElement = document.fullscreenElement
  fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen({
        navigationUI: 'hide',
      })
}

/**
 * Removes non-Latin characters from a string, replaces multiple spaces with a single space, and trims the string.
 *
 * @param {string} data - The input string to be processed.
 * @returns {string} The processed string with non-Latin characters removed, multiple spaces replaced by a single space, and trimmed.
 */
export function trimNonLatin(data: string) {
  return data
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/ +/g, ' ')
    .trim()
}

/**
 * A class that provides a blank writer implementation.
 *
 * This class is used to provide a no-op implementation of a writer, making it compatible with other writer interfaces.
 */
export class BlankWriter {
  constructor() {}

  /**
   * Initializes the writer.
   *
   * This method does nothing and is provided for compatibility with other writer interfaces.
   */
  async init() {
    //do nothing, just to make compatible with other writer
  }

  /**
   * Writes data to the writer.
   *
   * This method does nothing and is provided for compatibility with other writer interfaces.
   *
   * @param {string} key - The key associated with the data.
   * @param {Uint8Array|string} data - The data to be written.
   */
  async write(key: string, data: Uint8Array | string) {
    //do nothing, just to make compatible with other writer
  }

  /**
   * Ends the writing process.
   *
   * This method does nothing and is provided for compatibility with other writer interfaces.
   */
  async end() {
    //do nothing, just to make compatible with other writer
  }
}

export interface LoadInternalBackupOptions {
  signal?: AbortSignal | null
  onProgress?: ServerBackupProgressCallback
}

export type LoadInternalBackupStatus = 'ok' | 'error' | 'unavailable' | 'cancelled'

export async function loadInternalBackup(options: LoadInternalBackupOptions = {}): Promise<LoadInternalBackupStatus> {
  reportInternalBackupProgress(options.onProgress, {
    phase: 'request',
    message: 'Loading server backups',
    percent: 5,
  })
  const list = await listServerBackups(options.signal)
  if (list.status === 'unavailable') return 'unavailable'
  if (list.status === 'error') {
    alertError(list.error)
    return 'error'
  }
  if (list.backups.length === 0) {
    alertNormal('No server backups found')
    return 'cancelled'
  }

  reportInternalBackupProgress(options.onProgress, {
    phase: 'prepare',
    message: 'Waiting for backup selection',
    percent: 15,
  })
  const selectOptions = [
    'Cancel',
    ...list.backups.map((backup) => {
      const label = backup.label ? `${backup.label} - ` : ''
      return `${label}${new Date(backup.createdAt).toLocaleString()}`
    }),
  ]
  const alertResult = parseInt(await alertSelect(selectOptions)) - 1
  if (alertResult === -1) return 'cancelled'

  const selectedBackup = list.backups[alertResult]
  const restored = await restoreServerBackup({
    id: selectedBackup.id,
    signal: options.signal,
    onProgress: scaleInternalBackupProgress(options.onProgress, 20, 100),
  })
  if (restored.status === 'ok') {
    alertNormal('Loaded server backup')
    return 'ok'
  } else if (restored.status === 'error') {
    alertError(restored.error)
    return 'error'
  }
  return 'unavailable'
}

function reportInternalBackupProgress(
  onProgress: ServerBackupProgressCallback | undefined,
  progress: ServerBackupProgress,
): void {
  if (!onProgress) return
  onProgress({
    ...progress,
    percent: progress.percent === null ? null : Math.max(0, Math.min(100, Number(progress.percent))),
  })
}

function scaleInternalBackupProgress(
  onProgress: ServerBackupProgressCallback | undefined,
  start: number,
  end: number,
): ServerBackupProgressCallback | undefined {
  if (!onProgress) return undefined
  return (progress) => {
    reportInternalBackupProgress(onProgress, {
      ...progress,
      percent:
        progress.percent === null ? null : start + ((end - start) * Math.max(0, Math.min(100, progress.percent))) / 100,
    })
  }
}

/**
 * A debugging class for performance measurement.
 */

export class PerformanceDebugger {
  kv: { [key: string]: number[] } = {}
  startTime: number
  endTime: number

  /**
   * Starts the timing measurement.
   */
  start() {
    this.startTime = performance.now()
  }

  /**
   * Ends the timing measurement and records the time difference.
   *
   * @param {string} key - The key to associate with the recorded time.
   */
  endAndRecord(key: string) {
    this.endTime = performance.now()
    if (!this.kv[key]) {
      this.kv[key] = []
    }
    this.kv[key].push(this.endTime - this.startTime)
  }

  /**
   * Ends the timing measurement, records the time difference, and starts a new timing measurement.
   *
   * @param {string} key - The key to associate with the recorded time.
   */
  endAndRecordAndStart(key: string) {
    this.endAndRecord(key)
    this.start()
  }

  /**
   * Logs the average time for each key to the console.
   */
  log() {
    let table: { [key: string]: number } = {}

    for (const key in this.kv) {
      table[key] = this.kv[key].reduce((a, b) => a + b, 0) / this.kv[key].length
    }

    console.table(table)
  }

  combine(other: PerformanceDebugger) {
    for (const key in other.kv) {
      if (!this.kv[key]) {
        this.kv[key] = []
      }
      this.kv[key].push(...other.kv[key])
    }
  }
}

export function getLanguageCodes() {
  let languageCodes: {
    code: string
    name: string
  }[] = []

  for (let i = 0x41; i <= 0x5a; i++) {
    for (let j = 0x41; j <= 0x5a; j++) {
      languageCodes.push({
        code: String.fromCharCode(i) + String.fromCharCode(j),
        name: '',
      })
    }
  }

  languageCodes = languageCodes
    .map((v) => {
      return {
        code: v.code.toLocaleLowerCase(),
        name: new Intl.DisplayNames([DBState.db.language === 'cn' ? 'zh' : DBState.db.language], {
          type: 'language',
          fallback: 'none',
        }).of(v.code),
      }
    })
    .filter((a) => {
      return a.name
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return languageCodes
}

export function getVersionString(): string {
  return appVer
}

export function toGetter<T extends object>(
  getterFn: () => T,
  args?: {
    //blocks this.children from being accessed
    restrictChildren: string[]
  },
): T {
  const dummyTarget = () => {}

  return new Proxy(dummyTarget, {
    get(target, prop, receiver) {
      const realInstance = getterFn()

      if (args?.restrictChildren && args.restrictChildren.includes(prop as string)) {
        throw new Error(`Access to property '${String(prop)}' is restricted`)
      }

      if (realInstance === null || realInstance === undefined) {
        return (realInstance as any)[prop]
      }

      const value = Reflect.get(realInstance as object, prop)

      if (typeof value === 'function') {
        return value.bind(realInstance)
      }

      return value
    },

    set(target, prop, value, receiver) {
      if (args?.restrictChildren && args.restrictChildren.includes(prop as string)) {
        throw new Error(`Access to property '${String(prop)}' is restricted`)
      }
      const realInstance = getterFn()
      return Reflect.set(realInstance as object, prop, value, receiver)
    },

    has(target, prop) {
      const realInstance = getterFn()
      return Reflect.has(realInstance as object, prop)
    },

    ownKeys(target) {
      const realInstance = getterFn()
      return Reflect.ownKeys(realInstance as object)
    },

    construct(target, argArray, newTarget) {
      const realInstance = getterFn() as any
      return new realInstance(...argArray)
    },

    deleteProperty(target, prop) {
      const realInstance = getterFn()
      return Reflect.deleteProperty(realInstance as object, prop)
    },

    getPrototypeOf() {
      const realInstance = getterFn()
      return Reflect.getPrototypeOf(realInstance as object)
    },
  }) as unknown as T
}

const countriesWithAiLaw = new Set<string>([
  // EU
  // AI Act
  // https://artificialintelligenceact.eu/

  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'EL',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',

  //China
  //Measures for Labeling of AI-Generated Synthetic Content
  // 关于印发《人工智能生成合成内容标识办法》的通知
  // https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm
  'CN',

  //Although CN Law doesn't apply, just in case
  'HK',
  'MO',

  //TW isn't under mainland china jurisdiction
  //de facto, de jure in TW law, unlike HK and MO,
  // So it is excluded.
  //"TW",

  // Republic of Korea
  // AI Basic Act
  // 인공지능 발전과 신뢰 기반 조성 등에 관한 기본법
  // https://www.law.go.kr/%EB%B2%95%EB%A0%B9/%EC%9D%B8%EA%B3%B5%EC%A7%80%EB%8A%A5%20%EB%B0%9C%EC%A0%84%EA%B3%BC%20%EC%8B%A0%EB%A2%B0%20%EA%B8%B0%EB%B0%98%20%EC%A1%B0%EC%84%B1%20%EB%93%B1%EC%97%90%20%EA%B4%80%ED%95%9C%20%EA%B8%B0%EB%B3%B8%EB%B2%95/(20676,20250121)
  'KR',

  // Vietnam
  // Digital Tech Law
  // Luật Công nghệ số
  'VN',
])

export function aiLawApplies(): boolean {
  // Conservative default: AI disclosure law applies.

  return true
}

export function aiWatermarkingLawApplies(): boolean {
  // Watermark metadata is disabled; this function does not inspect jurisdiction.
  return false
}

export const chatFoldedState = $state<{
  data: null | {
    targetCharacterId: string
    targetChatId: string
    targetMessageId: string
  }
}>({
  data: null,
})

//Since its exported, we cannot use $derived here
export let chatFoldedStateMessageIndex = $state({
  index: -1,
})

$effect.root(() => {
  $effect(() => {
    if (!chatFoldedState.data) {
      return
    }
    const char = DBState.db.characters[selIdState.selId]
    const chat = char.chats[char.chatPage]
    if (chatFoldedState.data.targetCharacterId !== char.chaId) {
      chatFoldedState.data = null
    }
    if (chatFoldedState.data.targetChatId !== chat.id) {
      chatFoldedState.data = null
    }
  })

  $effect(() => {
    if (chatFoldedState.data === null) {
      chatFoldedStateMessageIndex.index = -1
      return
    }
    const char = DBState.db.characters[selIdState.selId]
    const chat = char.chats[char.chatPage]
    const messageIndex = chat.message.findIndex((v) => {
      return chatFoldedState.data?.targetMessageId === v.chatId
    })
    if (messageIndex === -1) {
      console.warn('Target message for folding id' + chatFoldedState.data?.targetMessageId + ' not found')
      chatFoldedStateMessageIndex.index = -1
      return
    }
    chatFoldedStateMessageIndex.index = messageIndex
  })
})

export function foldChatToMessage(targetMessageIdOrIndex: string | number) {
  let targetMessageId = ''
  if (typeof targetMessageIdOrIndex === 'number') {
    const char = getCurrentCharacter()
    const chat = char.chats[char.chatPage]
    const message = chat.message[targetMessageIdOrIndex]
    targetMessageId = message.chatId
  } else {
    targetMessageId = targetMessageIdOrIndex
  }
  const char = getCurrentCharacter()
  const chat = char.chats[char.chatPage]
  chatFoldedState.data = {
    targetCharacterId: char.chaId,
    targetChatId: chat.id,
    targetMessageId: targetMessageId,
  }
}

export function changeChatTo(IdOrIndex: string | number) {
  // Scalar rollback: selecting a chat only flips `chatPage`, so capturing
  // the whole-characters ChatStateSnapshot here deep-cloned every hydrated
  // transcript on the UI thread per chat click.
  const previous = currentChatSelectionSnapshot()
  const currentCharacter = getCurrentCharacter()
  let index = -1
  if (typeof IdOrIndex === 'number') {
    index = IdOrIndex
  }

  if (typeof IdOrIndex === 'string') {
    index = currentCharacter.chats.findIndex((v) => {
      return v.id === IdOrIndex
    })
  }

  if (index === -1) {
    return
  }

  withTrustedServerProjectionWrite(() => {
    DBState.db.characters[selIdState.selId].chatPage = index
  })
  const chatId = currentCharacter.chats[index]?.id
  if (chatId) {
    dispatchSelectChat(chatId, previous)
  }
  reloadGuiDisplay()
}

export function createChatCopyName(originalName: string, type: 'Copy' | 'Branch'): string {
  let name = originalName.replaceAll(/\(((Copy|Branch)( \d+)?)\)$/g, '').trim()
  let copyIndex = 1
  let newName = `${name} (${type})`
  const char = getCurrentCharacter()
  while (char.chats.find((v) => v.name === newName)) {
    copyIndex++
    newName = `${name} (${type} ${copyIndex})`
  }
  return newName
}
