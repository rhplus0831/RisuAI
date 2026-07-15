import { get, writable } from 'svelte/store'
import { sleep } from './util'
import { language } from '../lang'
import { getDatabase, type MessageGenerationInfo } from './storage/database.svelte'
import { alertStore as alertStoreImported } from './stores.svelte'

export interface alertData {
  type:
    | 'error'
    | 'normal'
    | 'none'
    | 'ask'
    | 'wait'
    | 'selectChar'
    | 'input'
    | 'toast'
    | 'wait2'
    | 'markdown'
    | 'select'
    | 'login'
    | 'tos'
    | 'cardexport'
    | 'requestdata'
    | 'addchar'
    | 'selectModule'
    | 'chatOptions'
    | 'pukmakkurit'
    | 'branches'
    | 'progress'
    | 'pluginconfirm'
    | 'requestlogs'
  msg: string
  submsg?: string
  datalist?: [string, string][]
  stackTrace?: string
  defaultValue?: string
  progress?: number | null
}

type AlertGenerationInfoStoreData = {
  genInfo: MessageGenerationInfo
  idx: number
}
export const alertGenerationInfoStore = writable<AlertGenerationInfoStoreData | undefined>(undefined)
export const alertStore = {
  set: (d: alertData) => {
    alertStoreImported.set(d)
  },
}

export function alertError(msg: unknown) {
  console.error(msg)
  const db = getDatabase()

  let stackTrace: string | undefined = undefined
  let message: string

  if (msg instanceof Error) {
    stackTrace = msg.stack
    message = msg.message
  } else {
    try {
      message = String(msg)
    } catch {
      message = '[unprintable error]'
    }
  }

  message = message.trim()

  const ignoredErrors = ['{}']

  if (ignoredErrors.includes(message)) {
    return
  }

  let submsg = ''

  //check if it's a known error
  if (message.includes('Failed to fetch') || message.includes('NetworkError when attempting to fetch resource.')) {
    submsg = db.usePlainFetch ? language.errors.networkFetchPlain : language.errors.networkFetch
  }

  alertStoreImported.set({
    type: 'error',
    msg: message,
    submsg: submsg,
    stackTrace: stackTrace,
  })
}

export async function waitAlert() {
  while (true) {
    if (get(alertStoreImported).type === 'none') {
      break
    }
    await sleep(10)
  }
}

export function alertNormal(msg: string) {
  alertStoreImported.set({
    type: 'normal',
    msg: msg,
  })
}

export async function alertNormalWait(msg: string) {
  alertStoreImported.set({
    type: 'normal',
    msg: msg,
  })
  await waitAlert()
}

export async function alertAddCharacter() {
  alertStoreImported.set({
    type: 'addchar',
    msg: language.addCharacter,
  })
  await waitAlert()

  return get(alertStoreImported).msg
}

export async function alertChatOptions() {
  alertStoreImported.set({
    type: 'chatOptions',
    msg: language.chatOptions,
  })
  await waitAlert()

  return parseInt(get(alertStoreImported).msg)
}

export async function alertLogin() {
  alertStoreImported.set({
    type: 'login',
    msg: 'login',
  })
  await waitAlert()

  return get(alertStoreImported).msg
}

export async function alertSelect(msg: string[], display?: string) {
  const message = display !== undefined ? `__DISPLAY__${display}||${msg.join('||')}` : msg.join('||')
  alertStoreImported.set({
    type: 'select',
    msg: message,
  })

  await waitAlert()

  return get(alertStoreImported).msg
}

export async function alertErrorWait(msg: string) {
  alertStoreImported.set({
    type: 'wait2',
    msg: msg,
  })
  await waitAlert()
}

export function alertMd(msg: string) {
  alertStoreImported.set({
    type: 'markdown',
    msg: msg,
  })
}

export function doingAlert() {
  return (
    get(alertStoreImported).type !== 'none' &&
    get(alertStoreImported).type !== 'toast' &&
    get(alertStoreImported).type !== 'wait'
  )
}

export function alertToast(msg: string) {
  alertStoreImported.set({
    type: 'toast',
    msg: msg,
  })
}

export function alertWait(msg: string) {
  alertStoreImported.set({
    type: 'wait',
    msg: msg,
  })
}

function normalizeProgress(progress: number) {
  if (!Number.isFinite(progress)) {
    return 0
  }

  return Math.max(0, Math.min(100, progress))
}

export function alertProgress(msg: string, progress: number | null, submsg?: string) {
  const data: alertData = {
    type: 'progress',
    msg: msg,
    progress: progress === null ? null : normalizeProgress(progress),
  }

  if (submsg !== undefined) {
    data.submsg = submsg
  }

  alertStoreImported.set(data)
}

export function alertClear() {
  alertStoreImported.set({
    type: 'none',
    msg: '',
  })
}

export async function alertSelectChar() {
  alertStoreImported.set({
    type: 'selectChar',
    msg: '',
  })

  await waitAlert()

  return get(alertStoreImported).msg
}

export async function alertConfirm(msg: string) {
  alertStoreImported.set({
    type: 'ask',
    msg: msg,
  })

  await waitAlert()

  return get(alertStoreImported).msg === 'yes'
}

export async function alertPluginConfirm(msg: string) {
  alertStoreImported.set({
    type: 'pluginconfirm',
    msg: msg,
  })

  await waitAlert()

  return get(alertStoreImported).msg === 'yes'
}

export interface CardExportResult {
  type: string
  type2: string
}

export function cardExportCancelMessage(type2 = ''): string {
  return JSON.stringify({ type: 'cancel', type2 })
}

export function parseCardExportResult(message: string): CardExportResult {
  try {
    const result = JSON.parse(message) as Partial<CardExportResult> | null
    if (result && typeof result.type === 'string' && typeof result.type2 === 'string') {
      return { type: result.type, type2: result.type2 }
    }
  } catch {
    // Modal dismissal can replace the alert before it writes a result.
  }
  return { type: 'cancel', type2: '' }
}

export async function alertCardExport(type: string = ''): Promise<CardExportResult> {
  alertStoreImported.set({
    type: 'cardexport',
    msg: '',
    submsg: type,
  })

  await waitAlert()

  return parseCardExportResult(get(alertStoreImported).msg)
}

export async function alertTOS() {
  if (import.meta.env.VITE_RISU_AGENT_DEV_IGNORE_TOS === 'TRUE') {
    return true
  }

  if (localStorage.getItem('tos4') === 'true') {
    return true
  }

  alertStoreImported.set({
    type: 'tos',
    msg: 'tos',
  })

  await waitAlert()

  if (get(alertStoreImported).msg === 'yes') {
    localStorage.setItem('tos4', 'true')
    return true
  }

  if (localStorage.getItem('tos2') && Date.now() - new Date('2026-05-15').getTime() < 0) {
    // The tos2 acceptance was honored only during the grace period ending 2026-05-15.
    return true
  }

  return false
}

export async function alertInput(msg: string, datalist?: [string, string][], defaultValue?: string) {
  alertStoreImported.set({
    type: 'input',
    msg: msg,
    datalist: datalist ?? [],
    defaultValue: defaultValue ?? '',
  })

  await waitAlert()

  return get(alertStoreImported).msg
}

export async function alertModuleSelect() {
  alertStoreImported.set({
    type: 'selectModule',
    msg: '',
  })

  while (true) {
    if (get(alertStoreImported).type === 'none') {
      break
    }
    await sleep(20)
  }

  return get(alertStoreImported).msg
}

export function alertRequestData(info: AlertGenerationInfoStoreData) {
  alertGenerationInfoStore.set(info)
  alertStoreImported.set({
    type: 'requestdata',
    msg: info.genInfo.generationId ?? 'none',
  })
}

export function alertRequestLogs() {
  alertStoreImported.set({
    type: 'requestlogs',
    msg: '',
  })
}
