<script lang="ts">
  let { idx = -1, message = '' }: { idx?: number; message?: string } = $props()
</script>

<div class="risu-chat" data-chat-index={idx}>{message}</div>
