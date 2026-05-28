import { dispatchAppendMessage, dispatchUpdateMessage, runChatCommandSequence } from '../chatCommands'

// Accepted shape A: route both dispatches through the serializing sequencer.
// Each step runs against the revision left by the previous one, so there is no
// race on the cached command revision.
export async function applyTriggerEditsViaSequencer(): Promise<void> {
  await runChatCommandSequence([
    () => dispatchAppendMessage('first'),
    () => dispatchUpdateMessage('target-id', 'second'),
  ])
}

// Accepted shape B: await each dispatch before issuing the next one. The second
// dispatch observes the revision bump from the first.
export async function applyTriggerEditsAwaited(): Promise<void> {
  await dispatchAppendMessage('first')
  await dispatchUpdateMessage('target-id', 'second')
}
