import { get, writable } from 'svelte/store'
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
  waitOwner?: AlertWaitHandle
  dialogOwner?: AlertDialogHandle
}

export type AlertWaitHandle = symbol
export type AlertDialogHandle = symbol

type ConfirmationAlertType = 'ask' | 'pluginconfirm'

interface ConfirmationRequest {
  owner: AlertDialogHandle
  type: ConfirmationAlertType
  msg: string
  resolve: (confirmed: boolean) => void
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

const confirmationQueue: ConfirmationRequest[] = []
let activeConfirmation: ConfirmationRequest | undefined
let confirmationQueueBlocked = false
let confirmationResumeTimer: ReturnType<typeof setTimeout> | undefined

function displayConfirmation(request: ConfirmationRequest) {
  alertStoreImported.set({
    type: request.type,
    msg: request.msg,
    dialogOwner: request.owner,
  })
}

function showNextConfirmation() {
  if (activeConfirmation || confirmationQueue.length === 0 || confirmationQueueBlocked) return
  if (get(alertStoreImported).type !== 'none') return

  activeConfirmation = confirmationQueue.shift()
  if (activeConfirmation) displayConfirmation(activeConfirmation)
}

function resumeConfirmationQueueAfterCurrentCallers() {
  if (confirmationResumeTimer !== undefined) return

  confirmationResumeTimer = setTimeout(() => {
    confirmationResumeTimer = undefined
    showNextConfirmation()
  }, 0)
}

function settleActiveConfirmation(confirmed: boolean) {
  const request = activeConfirmation
  if (!request) return

  activeConfirmation = undefined
  request.resolve(confirmed)
}

alertStoreImported.subscribe((value) => {
  const request = activeConfirmation
  if (request) {
    const isOwnedDialog = value.type === request.type && value.dialogOwner === request.owner
    if (isOwnedDialog) return

    const isOwnedResult = value.type === 'none' && value.dialogOwner === request.owner
    settleActiveConfirmation(isOwnedResult && value.msg === 'yes')
    confirmationQueueBlocked = value.type !== 'none'
  }

  if (value.type === 'none') {
    confirmationQueueBlocked = false
    if (request) {
      showNextConfirmation()
    } else {
      // An unrelated modal owns its result until its awaiting caller resumes.
      // Starting a queued confirmation in this same store notification would
      // replace that result before the caller can read it.
      resumeConfirmationQueueAfterCurrentCallers()
    }
  }
})

function queueConfirmation(type: ConfirmationAlertType, msg: string): Promise<boolean> {
  const promise = new Promise<boolean>((resolve) => {
    confirmationQueue.push({
      owner: Symbol('alert-dialog'),
      type,
      msg,
      resolve,
    })
  })

  showNextConfirmation()
  return promise
}

/**
 * Resolves only the confirmation dialog that owns the supplied handle. A stale
 * button or callback from an older dialog cannot settle the next queued prompt.
 */
export function resolveAlertConfirmation(owner: AlertDialogHandle | undefined, confirmed: boolean): boolean {
  const request = activeConfirmation
  const current = get(alertStoreImported)
  if (!request || owner !== request.owner || current.dialogOwner !== request.owner || current.type !== request.type) {
    return false
  }

  alertStoreImported.set({
    type: 'none',
    msg: confirmed ? 'yes' : 'no',
    dialogOwner: request.owner,
  })
  return true
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

export function waitAlert(): Promise<alertData> {
  const current = get(alertStoreImported)
  if (current.type === 'none') return Promise.resolve(current)

  return new Promise((resolve) => {
    let unsubscribe: (() => void) | undefined
    let completed = false
    const handleValue = (value: alertData) => {
      if (value.type !== 'none') return
      completed = true
      resolve(value)
      unsubscribe?.()
    }

    unsubscribe = alertStoreImported.subscribe(handleValue)
    if (completed) unsubscribe()
  })
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
  return (await waitAlert()).msg
}

export async function alertChatOptions() {
  alertStoreImported.set({
    type: 'chatOptions',
    msg: language.chatOptions,
  })
  return parseInt((await waitAlert()).msg)
}

export async function alertLogin() {
  alertStoreImported.set({
    type: 'login',
    msg: 'login',
  })
  return (await waitAlert()).msg
}

export async function alertSelect(msg: string[], display?: string) {
  const message = display !== undefined ? `__DISPLAY__${display}||${msg.join('||')}` : msg.join('||')
  alertStoreImported.set({
    type: 'select',
    msg: message,
  })

  return (await waitAlert()).msg
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

export function beginAlertWait(msg: string): AlertWaitHandle {
  const waitOwner = Symbol('alert-wait')
  alertStoreImported.set({
    type: 'wait',
    msg,
    waitOwner,
  })
  return waitOwner
}

export function updateAlertWait(waitOwner: AlertWaitHandle, msg: string): boolean {
  const current = get(alertStoreImported)
  if (current.type !== 'wait' || current.waitOwner !== waitOwner) return false

  alertStoreImported.set({
    type: 'wait',
    msg,
    waitOwner,
  })
  return true
}

export function clearAlertWait(waitOwner: AlertWaitHandle): boolean {
  const current = get(alertStoreImported)
  if (current.type !== 'wait' || current.waitOwner !== waitOwner) return false

  alertStoreImported.set({
    type: 'none',
    msg: '',
  })
  return true
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

  return (await waitAlert()).msg
}

export function alertConfirm(msg: string) {
  return queueConfirmation('ask', msg)
}

export function alertPluginConfirm(msg: string) {
  return queueConfirmation('pluginconfirm', msg)
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

  return parseCardExportResult((await waitAlert()).msg)
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

  const result = await waitAlert()

  if (result.msg === 'yes') {
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

  return (await waitAlert()).msg
}

export async function alertModuleSelect() {
  alertStoreImported.set({
    type: 'selectModule',
    msg: '',
  })

  return (await waitAlert()).msg
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
