import type { TriggerSourceAttribution } from './triggerSource.js'

export type PostGenerationLuaProgressPhase = 'editOutput' | 'onOutput'
export type PostGenerationLuaProgressStatus = 'started' | 'running' | 'finished' | 'error'
export type LuaProgressLlmFunction = 'LLM' | 'axLLM'

export interface PostGenerationLuaProgressEvent {
  type: 'post_generation_progress'
  phase: PostGenerationLuaProgressPhase
  status: PostGenerationLuaProgressStatus
  runSeq: number
  ownerType?: TriggerSourceAttribution['ownerType']
  ownerId?: string
  ownerName?: string
  triggerId?: string
  triggerIndex?: number
  triggerComment?: string
  triggerType?: string
  effectIndex?: number
  effectType?: string
  llmCallCount: number
  pendingLlmCount: number
  llmCallCounts: Record<LuaProgressLlmFunction, number>
  pendingLlmCounts: Record<LuaProgressLlmFunction, number>
}

export interface ServerLuaRuntimeProgressSink {
  beginLlmCall(fn: LuaProgressLlmFunction): { finish(): void }
}

export interface BeginPostGenerationLuaProgressRunInput {
  phase: PostGenerationLuaProgressPhase
  source?: TriggerSourceAttribution
}

export interface PostGenerationLuaProgressRunHandle {
  sink: ServerLuaRuntimeProgressSink
  finish(status: Extract<PostGenerationLuaProgressStatus, 'finished' | 'error'>): void
}

interface ProgressRunState {
  phase: PostGenerationLuaProgressPhase
  runSeq: number
  source?: TriggerSourceAttribution
  active: boolean
  llmCallCounts: Record<LuaProgressLlmFunction, number>
  pendingLlmCounts: Record<LuaProgressLlmFunction, number>
}

function sourceFields(source: TriggerSourceAttribution | undefined): Partial<PostGenerationLuaProgressEvent> {
  if (!source) return {}
  return {
    ...(source.ownerType ? { ownerType: source.ownerType } : {}),
    ...(source.ownerId ? { ownerId: source.ownerId } : {}),
    ...(source.ownerName ? { ownerName: source.ownerName } : {}),
    ...(source.triggerId ? { triggerId: source.triggerId } : {}),
    ...(typeof source.triggerIndex === 'number' ? { triggerIndex: source.triggerIndex } : {}),
    ...(source.triggerComment ? { triggerComment: source.triggerComment } : {}),
    ...(source.triggerType ? { triggerType: source.triggerType } : {}),
    ...(typeof source.effectIndex === 'number' ? { effectIndex: source.effectIndex } : {}),
    ...(source.effectType ? { effectType: source.effectType } : {}),
  }
}

function totalCalls(counts: Record<LuaProgressLlmFunction, number>): number {
  return counts.LLM + counts.axLLM
}

function cloneCounts(counts: Record<LuaProgressLlmFunction, number>): Record<LuaProgressLlmFunction, number> {
  return { LLM: counts.LLM, axLLM: counts.axLLM }
}

export class PostGenerationLuaProgressTracker {
  private nextRunSeq = 1

  constructor(private readonly emit: (event: PostGenerationLuaProgressEvent) => void) {}

  beginRun(input: BeginPostGenerationLuaProgressRunInput): PostGenerationLuaProgressRunHandle {
    const run: ProgressRunState = {
      phase: input.phase,
      runSeq: this.nextRunSeq++,
      source: input.source,
      active: true,
      llmCallCounts: { LLM: 0, axLLM: 0 },
      pendingLlmCounts: { LLM: 0, axLLM: 0 },
    }

    const emitSnapshot = (status: PostGenerationLuaProgressStatus): void => {
      this.emit({
        type: 'post_generation_progress',
        phase: run.phase,
        status,
        runSeq: run.runSeq,
        ...sourceFields(run.source),
        llmCallCount: totalCalls(run.llmCallCounts),
        pendingLlmCount: totalCalls(run.pendingLlmCounts),
        llmCallCounts: cloneCounts(run.llmCallCounts),
        pendingLlmCounts: cloneCounts(run.pendingLlmCounts),
      })
    }

    emitSnapshot('started')

    return {
      sink: {
        beginLlmCall: (fn) => {
          run.llmCallCounts[fn] += 1
          run.pendingLlmCounts[fn] += 1
          emitSnapshot('running')
          let finished = false
          return {
            finish: () => {
              if (finished) return
              finished = true
              run.pendingLlmCounts[fn] = Math.max(0, run.pendingLlmCounts[fn] - 1)
              emitSnapshot(run.active ? 'running' : 'finished')
            },
          }
        },
      },
      finish: (status) => {
        if (!run.active) return
        run.active = false
        run.pendingLlmCounts.LLM = 0
        run.pendingLlmCounts.axLLM = 0
        emitSnapshot(status)
      },
    }
  }
}
