export const STARTUP_MILESTONES = [
  'entry',
  'shell-mounted',
  'observer-ready',
  'writer-ready',
  'plugins-ready',
  'chat-ready',
  'background-ready',
] as const

export type StartupMilestone = (typeof STARTUP_MILESTONES)[number]

export type StartupAttemptFailureCode =
  | 'writer-bootstrap-failed'
  | 'push-initialization-failed'
  | 'plugin-initialization-failed'
  | 'generation-recovery-failed'
  | 'runtime-initialization-failed'

export interface StartupAttemptSnapshot {
  attemptId: number
  startedAtMs: number
  completedAtMs?: number
  failedAtMs?: number
  failureCode?: StartupAttemptFailureCode
  failureMilestone?: StartupMilestone
}

export interface StartupReadinessSnapshot {
  schemaVersion: 1
  phase: StartupMilestone | null
  timestamps: Partial<Record<StartupMilestone, number>>
  durationsFromEntry: Partial<Record<StartupMilestone, number>>
  attempts: StartupAttemptSnapshot[]
}

export type StartupMilestoneRecordResult = 'duplicate' | 'pending' | 'transitioned'

const MARK_PREFIX = 'risu:startup:'
const MEASURE_PREFIX = 'risu:startup:entry-to-'

type StartupAttemptState = StartupAttemptSnapshot

const observedMilestoneTimes = new Map<StartupMilestone, number>()
const transitionTimes = new Map<StartupMilestone, number>()
const attempts: StartupAttemptState[] = []
const readinessListeners = new Set<() => void>()
let nextAttemptId = 1

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

function finiteTime(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : nowMs()
}

function currentMilestone(): StartupMilestone | null {
  for (let index = STARTUP_MILESTONES.length - 1; index >= 0; index -= 1) {
    const milestone = STARTUP_MILESTONES[index]
    if (transitionTimes.has(milestone)) return milestone
  }
  return null
}

function emitPerformanceEntries(milestone: StartupMilestone, atMs: number): void {
  const perf = globalThis.performance
  if (!perf?.mark) return

  const markName = `${MARK_PREFIX}${milestone}`
  try {
    perf.mark(markName, { startTime: atMs })
  } catch {
    perf.mark(markName)
  }

  if (milestone === 'entry' || !transitionTimes.has('entry') || !perf.measure) return
  const measureName = `${MEASURE_PREFIX}${milestone}`
  try {
    perf.measure(measureName, `${MARK_PREFIX}entry`, markName)
  } catch {
    // User Timing support must never affect startup behavior. The serializable
    // snapshot remains the source of truth when a browser rejects mark options.
  }
}

function notifyReadinessListeners(): void {
  for (const listener of readinessListeners) listener()
}

function flushObservedMilestones(): boolean {
  let transitioned = false
  for (const milestone of STARTUP_MILESTONES) {
    if (transitionTimes.has(milestone)) continue
    const observedAtMs = observedMilestoneTimes.get(milestone)
    if (observedAtMs === undefined) break

    const previousMilestoneIndex = STARTUP_MILESTONES.indexOf(milestone) - 1
    const previousAtMs =
      previousMilestoneIndex >= 0 ? (transitionTimes.get(STARTUP_MILESTONES[previousMilestoneIndex]) ?? 0) : 0
    const transitionAtMs = Math.max(previousAtMs, observedAtMs)
    transitionTimes.set(milestone, transitionAtMs)
    emitPerformanceEntries(milestone, transitionAtMs)
    transitioned = true
  }
  if (transitioned) notifyReadinessListeners()
  return transitioned
}

/**
 * Record that one semantic startup milestone has become ready. Signals may
 * arrive out of order; publication waits for every earlier milestone so the
 * externally visible timeline is always monotonic. The first signal wins.
 */
export function recordStartupMilestone(
  milestone: StartupMilestone,
  observedAtMs = nowMs(),
): StartupMilestoneRecordResult {
  if (observedMilestoneTimes.has(milestone)) return 'duplicate'
  observedMilestoneTimes.set(milestone, finiteTime(observedAtMs))
  const transitioned = flushObservedMilestones()
  return transitionTimes.has(milestone) && transitioned ? 'transitioned' : 'pending'
}

export function beginStartupAttempt(startedAtMs = nowMs()): number {
  const attemptId = nextAttemptId
  nextAttemptId += 1
  attempts.push({ attemptId, startedAtMs: finiteTime(startedAtMs) })
  notifyReadinessListeners()
  return attemptId
}

export function completeStartupAttempt(attemptId: number, completedAtMs = nowMs()): void {
  const attempt = attempts.find((candidate) => candidate.attemptId === attemptId)
  if (!attempt || attempt.completedAtMs !== undefined || attempt.failedAtMs !== undefined) return
  attempt.completedAtMs = Math.max(attempt.startedAtMs, finiteTime(completedAtMs))
  notifyReadinessListeners()
}

export function failStartupAttempt(
  attemptId: number,
  failureCode: StartupAttemptFailureCode,
  failureMilestone: StartupMilestone,
  failedAtMs = nowMs(),
): void {
  const attempt = attempts.find((candidate) => candidate.attemptId === attemptId)
  if (!attempt || attempt.completedAtMs !== undefined || attempt.failedAtMs !== undefined) return
  attempt.failedAtMs = Math.max(attempt.startedAtMs, finiteTime(failedAtMs))
  attempt.failureCode = failureCode
  attempt.failureMilestone = failureMilestone
  notifyReadinessListeners()
}

export function getStartupReadinessSnapshot(): StartupReadinessSnapshot {
  const timestamps = Object.fromEntries(transitionTimes) as Partial<Record<StartupMilestone, number>>
  const entryAtMs = timestamps.entry
  const durationsFromEntry = Object.fromEntries(
    [...transitionTimes].map(([milestone, atMs]) => [milestone, entryAtMs === undefined ? 0 : atMs - entryAtMs]),
  ) as Partial<Record<StartupMilestone, number>>

  return {
    schemaVersion: 1,
    phase: currentMilestone(),
    timestamps,
    durationsFromEntry,
    attempts: attempts.map((attempt) => ({ ...attempt })),
  }
}

export function waitForStartupMilestone(milestone: StartupMilestone, timeoutMs = 10_000): Promise<void> {
  if (transitionTimes.has(milestone)) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      readinessListeners.delete(onReadinessChange)
      reject(new Error(`Timed out waiting for startup milestone: ${milestone}`))
    }, timeoutMs)
    const onReadinessChange = () => {
      if (!transitionTimes.has(milestone)) return
      globalThis.clearTimeout(timeout)
      readinessListeners.delete(onReadinessChange)
      resolve()
    }
    readinessListeners.add(onReadinessChange)
  })
}

/** Test-only reset for the module singleton. */
export function resetStartupReadinessForTests(): void {
  observedMilestoneTimes.clear()
  transitionTimes.clear()
  attempts.length = 0
  readinessListeners.clear()
  nextAttemptId = 1

  const perf = globalThis.performance
  for (const milestone of STARTUP_MILESTONES) {
    perf?.clearMarks?.(`${MARK_PREFIX}${milestone}`)
    if (milestone !== 'entry') perf?.clearMeasures?.(`${MEASURE_PREFIX}${milestone}`)
  }
}
