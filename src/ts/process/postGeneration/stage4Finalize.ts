import type { MessageGenerationInfo } from '../../storage/database.svelte'
import { resolveStablePostGenerationMessage, type StablePostGenerationMessageTarget } from './stableTarget'

export interface StageTimings {
  stage1Start: number
  stage2Start: number
  stage3Start: number
  stage4Start: number
  stage1Duration: number
  stage2Duration: number
  stage3Duration: number
  stage4Duration: number
}

export interface FinalizeStage4Options {
  stageTimings: StageTimings
  generationInfo: MessageGenerationInfo
  target: StablePostGenerationMessageTarget | null
}

export function finalizeStage4(opts: FinalizeStage4Options): void {
  const { stageTimings, generationInfo, target } = opts
  stageTimings.stage4Duration = Date.now() - stageTimings.stage4Start
  if (generationInfo.stageTiming) {
    generationInfo.stageTiming.stage1 = stageTimings.stage1Duration
    generationInfo.stageTiming.stage2 = stageTimings.stage2Duration
    generationInfo.stageTiming.stage3 = stageTimings.stage3Duration
    generationInfo.stageTiming.stage4 = stageTimings.stage4Duration
  }
  // The generated row is already persisted by the generation operation. This
  // closeout only fills client-observed timing fields, so avoid a whole-chat
  // durable diff while retaining the exact stable-id owner resolution.
  const resolution = resolveStablePostGenerationMessage(target)
  if (resolution?.message.generationInfo) resolution.message.generationInfo = generationInfo
}
