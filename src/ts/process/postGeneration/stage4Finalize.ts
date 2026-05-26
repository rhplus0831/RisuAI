import { DBState } from '../../stores.svelte'
import { withTrustedServerProjectionWrite } from '../../server/projectionWriteGuard.svelte'
import type { MessageGenerationInfo } from '../../storage/database.svelte'

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
  selectedChar: number
  selectedChat: number
}

export function finalizeStage4(opts: FinalizeStage4Options): void {
  const { stageTimings, generationInfo, selectedChar, selectedChat } = opts
  stageTimings.stage4Duration = Date.now() - stageTimings.stage4Start
  if (generationInfo.stageTiming) {
    generationInfo.stageTiming.stage1 = stageTimings.stage1Duration
    generationInfo.stageTiming.stage2 = stageTimings.stage2Duration
    generationInfo.stageTiming.stage3 = stageTimings.stage3Duration
    generationInfo.stageTiming.stage4 = stageTimings.stage4Duration
  }
  const messages = DBState.db.characters[selectedChar].chats[selectedChat].message
  const lastMessageIndex = messages.length - 1
  if (lastMessageIndex >= 0 && messages[lastMessageIndex].generationInfo) {
    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[selectedChar].chats[selectedChat].message[
        lastMessageIndex
      ].generationInfo = generationInfo
    })
  }
}
