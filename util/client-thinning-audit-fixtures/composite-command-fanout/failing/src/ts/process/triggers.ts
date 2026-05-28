import { dispatchAppendMessage, dispatchUpdateMessage } from '../chatCommands'

// Anti-pattern: two mutating command helpers dispatched against one optimistic
// snapshot in the same scope, neither awaited nor routed through a sequencer.
// Both fire against the same cached command revision and race on the bump.
export async function applyTriggerEdits(): Promise<void> {
  dispatchAppendMessage('first')
  dispatchUpdateMessage('target-id', 'second')
}
