import sendSound from '../../etc/send.mp3'
import { getResourceDatabase as getDatabase } from '../server/resourceState.svelte'

/** Play the user-configured ding for one successfully completed chat generation. */
export function playMessageCompletionSoundIfEnabled(): void {
  if (!getDatabase().playMessage || typeof Audio === 'undefined') return

  const audio = new Audio(sendSound)
  void audio.play().catch(() => {})
}
