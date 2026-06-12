<script lang="ts">
  let { idx = -1, message = '', msgDisplay = '' }: { idx?: number; message?: string; msgDisplay?: string } = $props()
</script>

<div class="risu-chat" data-chat-index={idx}>{message || msgDisplay}</div>
