<script lang="ts">
  import { onMount } from 'svelte'
  import { defaultChatScreenTestChatController } from './DefaultChatScreen.testChatController'

  let {
    idx = -1,
    message = '',
    msgDisplay = '',
    halfStreamingTokensPerSecond = undefined,
    onInitialDisplayParseStart = undefined,
    onInitialDisplayParseSettled = undefined,
  }: {
    idx?: number
    message?: string
    msgDisplay?: string
    halfStreamingTokensPerSecond?: number
    onInitialDisplayParseStart?: (registration: symbol) => void
    onInitialDisplayParseSettled?: (registration: symbol) => void
  } = $props()

  const registration = Symbol('test-initial-display-parse')

  onMount(() => {
    if (!onInitialDisplayParseStart || !onInitialDisplayParseSettled) return

    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      onInitialDisplayParseSettled(registration)
    }
    onInitialDisplayParseStart(registration)
    const unregister = defaultChatScreenTestChatController.register(settle)

    return () => {
      unregister()
      settle()
    }
  })
</script>

<div class="risu-chat" data-chat-index={idx}>{message || msgDisplay}</div>
{#if halfStreamingTokensPerSecond !== undefined}
  <div data-testid="half-streaming-throughput">{halfStreamingTokensPerSecond}</div>
{/if}
