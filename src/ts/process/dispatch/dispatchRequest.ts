import { v4 } from 'uuid'
import type { character, Database, MessageGenerationInfo } from '../../storage/database.svelte'
import type { OpenAIChat } from '../index.svelte'
import { getGenerationModelString } from '../models/modelString'
import { requestChatData } from '../request/request'
import type { requestDataResponse } from '../request/request'

/** Subset of stageTimings the helper writes to. */
export interface DispatchStageTimings {
  stage1Duration: number
  stage2Duration: number
  stage3Start: number
}

export type DispatchSuccessReq = Exclude<requestDataResponse, { type: 'fail' }>

export type DispatchRequestResult =
  | { status: 'preview'; formated: OpenAIChat[] }
  | { status: 'previewPrompt'; body: string }
  | { status: 'aborted' }
  | { status: 'failed'; reason: string; generationInfo: MessageGenerationInfo }
  | {
      status: 'success'
      req: DispatchSuccessReq
      generationInfo: MessageGenerationInfo
      generationId: string
    }

/**
 * Run the provider dispatch helper: stage 3 transition, preview / previewPrompt
 * early returns, `requestChatData` invocation, model-override propagation,
 * post-provider abort and fail handling. Returns a discriminated union that
 * the coordinator dispatches on; the coordinator owns the `previewFormated` /
 * `previewBody` module-level assignments and the `throwError(reason)` call
 * on failure.
 *
 * The stage 3 transition fires unconditionally (both preview and the full
 * dispatch path observe stage 3); fail / abort exits leave stage 3 written.
 */
export async function dispatchRequest(args: {
  database: Database
  formated: OpenAIChat[]
  biases: [string, number][]
  currentChar: character
  nowChatroom: character
  inputTokens: number
  outputTokens: number
  maxContextTokens: number
  /** Mutated: `stage3Start` is written. */
  stageTimings: DispatchStageTimings
  abortSignal: AbortSignal
  isContinue: boolean
  isPreview: boolean
  isPreviewPrompt: boolean
  setProcessStage: (n: number) => void
}): Promise<DispatchRequestResult> {
  const {
    database: db,
    formated,
    biases,
    currentChar,
    nowChatroom,
    inputTokens,
    outputTokens,
    maxContextTokens,
    stageTimings,
    abortSignal,
    isContinue,
    isPreview,
    isPreviewPrompt,
    setProcessStage,
  } = args

  setProcessStage(3)
  stageTimings.stage3Start = Date.now()

  if (isPreview) {
    return { status: 'preview', formated }
  }

  const generationId = v4()
  const generationModel = getGenerationModelString()

  const generationInfo: MessageGenerationInfo = {
    model: generationModel,
    generationId,
    inputTokens,
    outputTokens,
    maxContext: maxContextTokens,
    stageTiming: {
      stage1: stageTimings.stage1Duration,
      stage2: stageTimings.stage2Duration,
      stage3: 0,
      stage4: 0,
    },
  }

  const req = await requestChatData(
    {
      database: db,
      formated,
      biasString: biases,
      currentChar,
      useStreaming: true,
      isGroupChat: false,
      bias: {},
      continue: isContinue,
      chatId: generationId,
      imageResponse: db.outputImageModal,
      previewBody: isPreviewPrompt,
      escape: nowChatroom.type === 'character' && nowChatroom.escapeOutput,
      rememberToolUsage: db.rememberToolUsage,
    },
    'model',
    abortSignal,
  )

  if (req.model) {
    generationInfo.model = getGenerationModelString(req.model)
  }

  if (isPreviewPrompt && req.type === 'success') {
    return { status: 'previewPrompt', body: req.result }
  }

  if (abortSignal.aborted === true) {
    return { status: 'aborted' }
  }

  if (req.type === 'fail') {
    return { status: 'failed', reason: req.result, generationInfo }
  }

  return { status: 'success', req, generationInfo, generationId }
}
