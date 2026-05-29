<script lang="ts">
  import { dispatchAppendMessage, dispatchUpdateMessage } from 'src/ts/chatCommands'

  // Accepted shape: the two mutating dispatches live in mutually-exclusive
  // if/else branches, so only one fires per invocation — no race. They share a
  // line with an `await`, which the old scan would have skipped; the hardened
  // AST rule recognizes the branch exclusivity instead of over-flagging.
  export async function applyEdit(serverMode: boolean): Promise<void> {
    const base = await Promise.resolve(0)
    if (serverMode) {
      void dispatchAppendMessage(String(base))
    } else {
      void dispatchUpdateMessage('id', String(base))
    }
  }
</script>

<button
  onclick={() => {
    if (Math.random() > 0.5) {
      void dispatchAppendMessage('a')
    } else {
      void dispatchUpdateMessage('id', 'b')
    }
  }}>edit</button>
