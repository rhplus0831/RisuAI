import { fetchServerBootstrapProjection } from './bootstrap'

// Anti-pattern: a passive, event-driven refresh path re-registers writer
// ownership by calling the writer-intent bootstrap helper. commands.ts is not
// in WRITER_BOOTSTRAP_CALLERS, so this steals the active-writer session.
export async function refreshOnCommandEvent(): Promise<void> {
  await fetchServerBootstrapProjection()
}
