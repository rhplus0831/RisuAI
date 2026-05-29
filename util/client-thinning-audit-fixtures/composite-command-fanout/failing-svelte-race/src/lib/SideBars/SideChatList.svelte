<script lang="ts">
  import { dispatchAppendMessage, dispatchUpdateMessage } from 'src/ts/chatCommands'

  // Adversarial A4R-fanout svelte defeat: both mutating dispatches sit on one
  // line that also holds an `await`. The old line-text scan skipped any line
  // containing `await` and recorded a line only once, so this two-dispatch
  // race was invisible. The hardened rule parses the <script> block as TS and
  // sees two co-reachable dispatches against one optimistic snapshot.
  export async function applyEdits(): Promise<void> {
    const base = await Promise.resolve(0); void dispatchAppendMessage('first'); void dispatchUpdateMessage('id', String(base))
  }
</script>

<button onclick={applyEdits}>edit</button>
