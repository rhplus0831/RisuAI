import { dispatchAppendMessage, dispatchUpdateMessage } from '../chatCommands'

// Violation: two mutating command helpers fire in one scope without awaiting or
// sequencing, racing on the same optimistic revision.
export async function applyTriggerEdits(): Promise<void> {
  dispatchAppendMessage('first')
  dispatchUpdateMessage('target-id', 'second')
}
