import { dispatchAppendMessage, dispatchUpdateMessage, runChatCommandSequence } from '../chatCommands'

// Accepted: the sequencer runs each dispatch against the previous revision.
export async function applyTriggerEditsViaSequencer(): Promise<void> {
  await runChatCommandSequence([
    () => dispatchAppendMessage('first'),
    () => dispatchUpdateMessage('target-id', 'second'),
  ])
}

// Accepted: awaiting each dispatch serializes the revision bump.
export async function applyTriggerEditsAwaited(): Promise<void> {
  await dispatchAppendMessage('first')
  await dispatchUpdateMessage('target-id', 'second')
}
