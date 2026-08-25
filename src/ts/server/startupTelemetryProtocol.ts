export const STARTUP_TELEMETRY_PROTOCOL_VERSION = 1 as const
export const STARTUP_TELEMETRY_MAX_BATCH_EVENTS = 32
export const STARTUP_TELEMETRY_MAX_ATTEMPTS = 10_000
export const STARTUP_TELEMETRY_MAX_DURATION_MS = 24 * 60 * 60 * 1000

export const STARTUP_TELEMETRY_MILESTONES = [
  'entry',
  'shell-mounted',
  'observer-ready',
  'writer-ready',
  'plugins-ready',
  'chat-ready',
  'background-ready',
] as const

export type StartupTelemetryMilestone = (typeof STARTUP_TELEMETRY_MILESTONES)[number]

export const STARTUP_TELEMETRY_FAILURE_CODES = [
  'writer-bootstrap-failed',
  'push-initialization-failed',
  'plugin-initialization-failed',
  'generation-recovery-failed',
  'selected-character-hydration-failed',
  'selected-chat-hydration-failed',
  'selected-prompt-template-hydration-failed',
  'runtime-initialization-failed',
] as const

export type StartupTelemetryFailureCode = (typeof STARTUP_TELEMETRY_FAILURE_CODES)[number]

interface StartupTelemetryEventBase {
  attemptCount: number
  observerShellEnabled: boolean
}

export interface StartupTelemetryPhaseEvent extends StartupTelemetryEventBase {
  kind: 'phase-ready'
  milestone: StartupTelemetryMilestone
  /** Monotonic duration from the entry mark to this milestone. */
  entryDurationMs: number
}

export interface StartupTelemetryAttemptCompletedEvent extends StartupTelemetryEventBase {
  kind: 'attempt-completed'
  attemptDurationMs: number
}

export interface StartupTelemetryAttemptFailedEvent extends StartupTelemetryEventBase {
  kind: 'attempt-failed'
  attemptDurationMs: number
  failureCode: StartupTelemetryFailureCode
  failureMilestone: StartupTelemetryMilestone
}

export interface StartupTelemetryDiagnosticFailureEvent extends StartupTelemetryEventBase {
  kind: 'diagnostic-failure'
  failureCode: StartupTelemetryFailureCode
  failureMilestone: StartupTelemetryMilestone
}

export type StartupTelemetryEvent =
  | StartupTelemetryPhaseEvent
  | StartupTelemetryAttemptCompletedEvent
  | StartupTelemetryAttemptFailedEvent
  | StartupTelemetryDiagnosticFailureEvent

export interface StartupTelemetryBatch {
  version: typeof STARTUP_TELEMETRY_PROTOCOL_VERSION
  events: StartupTelemetryEvent[]
}

export interface StartupTelemetryConfiguration {
  version: typeof STARTUP_TELEMETRY_PROTOCOL_VERSION
  sampleRate: 1
}

const MILESTONES = new Set<string>(STARTUP_TELEMETRY_MILESTONES)
const FAILURE_CODES = new Set<string>(STARTUP_TELEMETRY_FAILURE_CODES)

export function isStartupTelemetryBatch(value: unknown): value is StartupTelemetryBatch {
  if (!hasExactKeys(value, ['version', 'events'])) return false
  if (value.version !== STARTUP_TELEMETRY_PROTOCOL_VERSION || !Array.isArray(value.events)) return false
  return (
    value.events.length > 0 &&
    value.events.length <= STARTUP_TELEMETRY_MAX_BATCH_EVENTS &&
    value.events.every(isStartupTelemetryEvent)
  )
}

export function isStartupTelemetryConfiguration(value: unknown): value is StartupTelemetryConfiguration {
  return (
    hasExactKeys(value, ['version', 'sampleRate']) &&
    value.version === STARTUP_TELEMETRY_PROTOCOL_VERSION &&
    value.sampleRate === 1
  )
}

export function isStartupTelemetryEvent(value: unknown): value is StartupTelemetryEvent {
  if (!isRecord(value)) return false
  if (!validAttemptCount(value.attemptCount) || typeof value.observerShellEnabled !== 'boolean') return false

  switch (value.kind) {
    case 'phase-ready':
      return (
        hasExactKeys(value, ['kind', 'milestone', 'entryDurationMs', 'attemptCount', 'observerShellEnabled']) &&
        validMilestone(value.milestone) &&
        validDuration(value.entryDurationMs)
      )
    case 'attempt-completed':
      return (
        hasExactKeys(value, ['kind', 'attemptDurationMs', 'attemptCount', 'observerShellEnabled']) &&
        validDuration(value.attemptDurationMs)
      )
    case 'attempt-failed':
      return (
        hasExactKeys(value, [
          'kind',
          'attemptDurationMs',
          'failureCode',
          'failureMilestone',
          'attemptCount',
          'observerShellEnabled',
        ]) &&
        validDuration(value.attemptDurationMs) &&
        validFailureCode(value.failureCode) &&
        validMilestone(value.failureMilestone)
      )
    case 'diagnostic-failure':
      return (
        hasExactKeys(value, ['kind', 'failureCode', 'failureMilestone', 'attemptCount', 'observerShellEnabled']) &&
        validFailureCode(value.failureCode) &&
        validMilestone(value.failureMilestone)
      )
    default:
      return false
  }
}

function validAttemptCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= STARTUP_TELEMETRY_MAX_ATTEMPTS
}

function validDuration(value: unknown): value is number {
  return Number.isFinite(value) && (value as number) >= 0 && (value as number) <= STARTUP_TELEMETRY_MAX_DURATION_MS
}

function validMilestone(value: unknown): value is StartupTelemetryMilestone {
  return typeof value === 'string' && MILESTONES.has(value)
}

function validFailureCode(value: unknown): value is StartupTelemetryFailureCode {
  return typeof value === 'string' && FAILURE_CODES.has(value)
}

function hasExactKeys<T extends readonly string[]>(value: unknown, keys: T): value is Record<T[number], unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
