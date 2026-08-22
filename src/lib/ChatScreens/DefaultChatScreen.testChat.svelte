<script lang="ts">
  import { onMount } from 'svelte'
  import { defaultChatScreenTestChatController } from './DefaultChatScreen.testChatController'

  let {
    idx = -1,
    message = '',
    msgDisplay = '',
    name = '',
    img = '',
    largePortrait = false,
    halfStreamingTokensPerSecond = undefined,
    onInitialDisplayParseStart = undefined,
    onInitialDisplayParseSettled = undefined,
  }: {
    idx?: number
    message?: string
    msgDisplay?: string
    name?: string
    img?: string | Promise<string>
    largePortrait?: boolean
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

<div
  class="risu-chat"
  data-chat-index={idx}
  data-chat-name={name}
  data-chat-image={typeof img === 'string' ? img : ''}
  data-chat-large-portrait={largePortrait ? 'true' : 'false'}>
  {message || msgDisplay}
</div>
{#if halfStreamingTokensPerSecond !== undefined}
  <div data-testid="half-streaming-throughput">{halfStreamingTokensPerSecond}</div>
{/if}
