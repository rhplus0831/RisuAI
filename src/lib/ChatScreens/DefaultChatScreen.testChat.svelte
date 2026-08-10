<script lang="ts">
  let {
    idx = -1,
    message = '',
    msgDisplay = '',
    halfStreamingTokensPerSecond = undefined,
  }: {
    idx?: number
    message?: string
    msgDisplay?: string
    halfStreamingTokensPerSecond?: number
  } = $props()
</script>

<div class="risu-chat" data-chat-index={idx}>{message || msgDisplay}</div>
{#if halfStreamingTokensPerSecond !== undefined}
  <div data-testid="half-streaming-throughput">{halfStreamingTokensPerSecond}</div>
{/if}
