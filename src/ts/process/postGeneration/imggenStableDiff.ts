import { getDatabase, type character } from '../../storage/database.svelte'
import { stableDiff } from '../stableDiff'

export interface RunImggenStableDiffOptions {
  abortSignal?: AbortSignal
  currentChar: character
  selectedChar: number
  selectedChat: number
}

export async function runImggenStableDiff(opts: RunImggenStableDiffOptions): Promise<void> {
  const msgs = getDatabase().characters[opts.selectedChar].chats[opts.selectedChat].message
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
