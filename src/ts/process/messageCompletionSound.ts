import sendSound from '../../etc/send.mp3'
import { getResourceDatabase as getDatabase } from '../server/resourceState.svelte'

let completionSoundElement: HTMLAudioElement | null = null
let completionSoundPrimingInstalled = false
let realDingInFlight = false
let warnedForNotAllowedError = false

const completionSoundPrimingListenerOptions: AddEventListenerOptions = {
  capture: true,
  passive: true,
}

function getCompletionSoundElement(): HTMLAudioElement | null {
  if (completionSoundElement) return completionSoundElement
  if (typeof Audio === 'undefined') return null

  completionSoundElement = new Audio(sendSound)
  completionSoundElement.preload = 'auto'
  completionSoundElement.addEventListener('ended', () => {
    realDingInFlight = false
  })
  return completionSoundElement
}

function readPlaybackError(error: unknown): { name: string; message: string } {
  if (typeof error !== 'object' || error === null) {
    return { name: 'Error', message: String(error) }
  }

  const candidate = error as { message?: unknown; name?: unknown }
  return {
    name: typeof candidate.name === 'string' ? candidate.name : 'Error',
    message: typeof candidate.message === 'string' ? candidate.message : String(error),
  }
}

function handleRealPlayRejection(error: unknown): void {
  realDingInFlight = false
  const { name, message } = readPlaybackError(error)
  if (name === 'NotAllowedError') {
    if (warnedForNotAllowedError) return
    warnedForNotAllowedError = true
  }
  console.warn(`Completion ding playback failed (${name}): ${message}`)
}

/** Prime the shared media element from a synchronous user-activation handler. */
export function primeCompletionSound(): void {
  if (realDingInFlight) return
  const element = getCompletionSoundElement()
  if (!element) return

  try {
    const playPromise = element.play()
    element.pause()
    element.currentTime = 0
    void playPromise.catch(() => {})
  } catch {
    // A failed prime is expected before the browser grants media playback.
  }
}

/** Install durable user-gesture priming for the shared completion sound element. */
export function installCompletionSoundPriming(): void {
  if (completionSoundPrimingInstalled || typeof document === 'undefined') return
  completionSoundPrimingInstalled = true
  document.addEventListener('pointerdown', primeCompletionSound, completionSoundPrimingListenerOptions)
  document.addEventListener('keydown', primeCompletionSound, completionSoundPrimingListenerOptions)
}

/** Play the shared completion ding without applying a feature setting gate. */
export function playCompletionDing(): void {
  const element = getCompletionSoundElement()
  if (!element) return

  element.currentTime = 0
  realDingInFlight = true
  try {
    void element.play().catch(handleRealPlayRejection)
  } catch (error) {
    handleRealPlayRejection(error)
  }
}

/** Play the user-configured ding for one successfully completed chat generation. */
export function playMessageCompletionSoundIfEnabled(): boolean {
  if (!getDatabase().playMessage || typeof Audio === 'undefined') return false

  playCompletionDing()
  return true
}
