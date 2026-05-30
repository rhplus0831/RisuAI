import { DBState } from '../../stores.svelte'
import type {
  character,
  MessageGenerationInfo,
} from '../../storage/database.svelte'
import { loadAndTrimCharEmotion } from './charEmotionStore'
import { applyEmotionFromResponse } from './emotionFromResponse'
import { runEmotionEmbeddingFallback } from './emotionFallbackEmbedding'
import { runEmotionLlmFallback } from './emotionFallbackLlm'
import { runImggenStableDiff } from './imggenStableDiff'
import { fireDesktopNotification } from './notification'
import { finalizeStage4, type StageTimings } from './stage4Finalize'
import type { DispatchSuccessReq } from '../dispatch/dispatchRequest'

export type RunStage4Result = { status: 'resend' } | { status: 'done' }

export interface RunStage4Args {
  req: DispatchSuccessReq
  currentChar: character
  result: string
  resendChat: boolean
  emoChanged: boolean
  abortSignal: AbortSignal
  selectedChar: number
  selectedChat: number
  /** Mutated: `stage3Duration`, `stage4Start`, `stage4Duration` written. */
  stageTimings: StageTimings
  /** Mutated: `stageTiming.stage3` written before stage 4 starts; `finalizeStage4` later writes all four stages. */
  generationInfo: MessageGenerationInfo
  throwError: (msg: string) => void
  setProcessStage: (n: number) => void
}

/**
 * Run the stage-4 closeout: write stage 3 duration into `generationInfo`,
 * transition to stage 4, then either resend (delegating the recursive
 * `sendChat` call back to the coordinator), drive the
 * notification / provider-emotion / emotion-fallback / imggen routing, or
 * finalize stage 4 cleanly.
 *
 * The discriminated-union return lets `resend` ask the coordinator to release
 * the `doingChat` lease and recurse into `sendChat` (the helper avoids the
 * circular import that direct recursion would
 * introduce); `done` means the helper has already called `finalizeStage4`
 * (default path) or intentionally skipped it (emotion-fallback paths,
 * preserving production behavior verbatim).
 */
export async function runStage4(args: RunStage4Args): Promise<RunStage4Result> {
  const {
    req,
    currentChar,
    result,
    resendChat,
    abortSignal,
    selectedChar,
    selectedChat,
    stageTimings,
    generationInfo,
    throwError,
    setProcessStage,
  } = args
  let emoChanged = args.emoChanged

  stageTimings.stage3Duration = Date.now() - stageTimings.stage3Start

  if (generationInfo.stageTiming) {
    generationInfo.stageTiming.stage3 = stageTimings.stage3Duration
  }
  setProcessStage(4)
  stageTimings.stage4Start = Date.now()

  if (resendChat) {
    finalizeStage4({ stageTimings, generationInfo, selectedChar, selectedChat })
    return { status: 'resend' }
  }

  if (DBState.db.notification) {
    await fireDesktopNotification(result)
  }

  if (
    req.special &&
    applyEmotionFromResponse({ emotion: req.special.emotion, currentChar })
  ) {
    emoChanged = true
  }

  if (!currentChar.inlayViewScreen) {
    if (currentChar.viewScreen === 'emotion' && !emoChanged && abortSignal.aborted === false) {
      const { tempEmotion, charemotions } = loadAndTrimCharEmotion(currentChar.chaId)

      if (DBState.db.emotionProcesser === 'embedding') {
        await runEmotionEmbeddingFallback({
          result,
          currentChar,
          tempEmotion,
          charemotions,
        })
        return { status: 'done' }
      }

      await runEmotionLlmFallback({
        result,
        currentChar,
        abortSignal,
        throwError,
        emotionPrompt2: DBState.db.emotionPrompt2,
        tempEmotion,
        charemotions,
      })
      return { status: 'done' }
    } else if (currentChar.viewScreen === 'imggen') {
      await runImggenStableDiff({ currentChar, selectedChar, selectedChat })
    }
  }

  finalizeStage4({ stageTimings, generationInfo, selectedChar, selectedChat })
  return { status: 'done' }
}
