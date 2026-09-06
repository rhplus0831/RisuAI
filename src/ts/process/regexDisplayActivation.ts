import type { customscript } from '../storage/database.svelte'
import { writable } from 'svelte/store'
import { normalizeRegexDisplayOwnerKey, reloadRegexDisplay } from './regexDisplayReload'

export const REGEX_DISPLAY_ACTIVATION_DELAY_MS = 3_000

export interface RegexDisplayActivationPendingState {
  run: number
  deadline: number
}

export type RegexDisplayActivationGate = (ownerKey: string) => boolean | Promise<boolean>

interface PendingRegexDisplayActivation extends RegexDisplayActivationPendingState {
  timer: ReturnType<typeof setTimeout> | null
  gate?: RegexDisplayActivationGate
}

let nextActivationRun = 0
const pendingActivations = new Map<string, PendingRegexDisplayActivation>()
export const RegexDisplayActivationPending = writable<Readonly<Record<string, RegexDisplayActivationPendingState>>>({})

export function scheduleRegexDisplayActivation(
  ownerKey: string | null | undefined,
  gate?: RegexDisplayActivationGate,
): void {
  const normalizedOwnerKey = normalizeRegexDisplayOwnerKey(ownerKey)
  const previous = pendingActivations.get(normalizedOwnerKey)
  if (previous?.timer) clearTimeout(previous.timer)

  const run = ++nextActivationRun
  const deadline = Date.now() + REGEX_DISPLAY_ACTIVATION_DELAY_MS
  const timer = setTimeout(() => {
    const pending = pendingActivations.get(normalizedOwnerKey)
    if (!pending || pending.run !== run) return
    pending.timer = null
    void activateRegexDisplay(normalizedOwnerKey, pending)
  }, REGEX_DISPLAY_ACTIVATION_DELAY_MS)
  pendingActivations.set(normalizedOwnerKey, { run, deadline, timer, ...(gate ? { gate } : {}) })
  publishPendingActivations()
}

async function activateRegexDisplay(ownerKey: string, pending: PendingRegexDisplayActivation): Promise<void> {
  let ready = true
  try {
    ready = (await pending.gate?.(ownerKey)) !== false
  } catch {
    ready = false
  }

  const current = pendingActivations.get(ownerKey)
  if (!current || current.run !== pending.run || !ready) return
  pendingActivations.delete(ownerKey)
  publishPendingActivations()
  reloadRegexDisplay(ownerKey)
}

export function cancelRegexDisplayActivation(ownerKey: string | null | undefined): void {
  const normalizedOwnerKey = normalizeRegexDisplayOwnerKey(ownerKey)
  const pending = pendingActivations.get(normalizedOwnerKey)
  if (!pending) return
  if (pending.timer) clearTimeout(pending.timer)
  pendingActivations.delete(normalizedOwnerKey)
  publishPendingActivations()
}

export function resetRegexDisplayActivationForTests(): void {
  for (const pending of pendingActivations.values()) {
    if (pending.timer) clearTimeout(pending.timer)
  }
  pendingActivations.clear()
  nextActivationRun = 0
  publishPendingActivations()
}

function publishPendingActivations(): void {
  RegexDisplayActivationPending.set(
    Object.fromEntries(
      Array.from(pendingActivations, ([ownerKey, pending]) => [
        ownerKey,
        { run: pending.run, deadline: pending.deadline },
      ]),
    ),
  )
}

function displayRelevantScript(script: customscript): boolean {
  return script.type === 'editdisplay' || script.type === 'edittrans'
}

/**
 * Only fields that can change rendered chat output belong in this signature.
 * Names and stable IDs are persistence metadata and must not trigger a reparse.
 */
export function regexDisplayDefinitionSignature(scripts: readonly customscript[] | null | undefined): string {
  return JSON.stringify(
    (scripts ?? []).filter(displayRelevantScript).map((script) => ({
      type: script.type,
      in: script.in,
      out: script.out,
      flag: script.flag ?? '',
      ableFlag: Boolean(script.ableFlag),
    })),
  )
}

/**
 * Tracks continued editor activity after a display change is already pending.
 * This keeps the expensive activation from firing while the user moves between
 * fields in the same editor.
 */
export function regexEditorActivitySignature(scripts: readonly customscript[] | null | undefined): string {
  return JSON.stringify(scripts ?? [])
}
