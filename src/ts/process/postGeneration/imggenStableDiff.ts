import type { character } from '../../storage/database.svelte'
import { stableDiff } from '../stableDiff'
import { resolveStablePostGenerationChat, type StablePostGenerationChatTarget } from './stableTarget'

export interface RunImggenStableDiffOptions {
  abortSignal?: AbortSignal
  currentChar: character
  target: StablePostGenerationChatTarget | null
}

export async function runImggenStableDiff(opts: RunImggenStableDiffOptions): Promise<void> {
  const resolution = resolveStablePostGenerationChat(opts.target)
  if (!resolution) return
  const msgs = resolution.chat.message
  let msgStr = ''
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'char') {
      msgStr = `character: ${msgs[i].data.replace(/\n/g, ' ')} \n` + msgStr
    } else {
      msgStr = `user: ${msgs[i].data.replace(/\n/g, ' ')} \n` + msgStr
      break
    }
  }
  if (opts.abortSignal?.aborted) return
  if (opts.abortSignal) {
    await stableDiff(opts.currentChar, msgStr, { signal: opts.abortSignal })
    return
  }
  await stableDiff(opts.currentChar, msgStr)
}
