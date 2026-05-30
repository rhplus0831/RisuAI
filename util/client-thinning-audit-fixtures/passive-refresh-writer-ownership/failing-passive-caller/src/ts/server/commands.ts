import { fetchServerBootstrapProjection } from './bootstrap'

// Violation: passive refresh calls the writer-intent bootstrap helper and
// re-registers active-writer ownership.
export async function refreshOnCommandEvent(): Promise<void> {
  await fetchServerBootstrapProjection()
}
