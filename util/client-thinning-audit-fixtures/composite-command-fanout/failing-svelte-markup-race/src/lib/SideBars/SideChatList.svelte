<script lang="ts">
  import { dispatchAppendMessage, dispatchUpdateMessage } from 'src/ts/chatCommands'
</script>

<!--
  Adversarial A4R-fanout svelte defeat in MARKUP: an inline event handler fans
  out two unserialized mutating dispatches against one optimistic snapshot. The
  hardened rule extracts the `={ ... }` handler expression and runs the same AST
  scope analysis, so the markup handler is covered, not just the <script> block.
-->
<button
  onclick={() => {
    void dispatchAppendMessage('first')
    void dispatchUpdateMessage('id', 'second')
  }}>edit</button>
