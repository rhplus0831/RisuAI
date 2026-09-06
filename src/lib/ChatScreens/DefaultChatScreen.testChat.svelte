<script lang="ts">
  import { onMount } from 'svelte'
  import { defaultChatScreenTestChatController } from './DefaultChatScreen.testChatController'
  import type { ChatGenerationLoadingPhase } from './chatGenerationLoading'
  import type { DisplaySourcePriority } from 'src/ts/server/displaySources'

  let {
    idx = -1,
    message = '',
    msgDisplay = '',
    name = '',
    img = '',
    largePortrait = false,
    isGenerationLoading = false,
    isGenerationProjection = false,
    generationPhase = undefined,
    generationStartedAt = undefined,
    generationStage = 0,
    halfStreamingTokensPerSecond = undefined,
    halfStreamingGeneratedTokens = undefined,
    onInitialDisplayParseStart = undefined,
    onInitialDisplayParseSettled = undefined,
    displayPriority = 'normal',
  }: {
    idx?: number
    message?: string
    msgDisplay?: string
    name?: string
    img?: string | Promise<string>
    largePortrait?: boolean
    isGenerationLoading?: boolean
    isGenerationProjection?: boolean
    generationPhase?: ChatGenerationLoadingPhase
    generationStartedAt?: number
    generationStage?: number
    halfStreamingTokensPerSecond?: number
    halfStreamingGeneratedTokens?: number
    onInitialDisplayParseStart?: (registration: symbol) => void
    onInitialDisplayParseSettled?: (registration: symbol) => void
    displayPriority?: DisplaySourcePriority
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
    // Older rows also report their body lifecycle, but this controller only
    // delays the critical rows whose parses own the startup skeleton.
    let unregister = () => {}
    if (displayPriority === 'background') queueMicrotask(settle)
    else unregister = defaultChatScreenTestChatController.register(settle)

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
  data-chat-large-portrait={largePortrait ? 'true' : 'false'}
  data-generation-phase={generationPhase}
  data-generation-started-at={generationStartedAt}
  data-generation-stage={generationStage}>
  {#if isGenerationLoading && (!isGenerationProjection || message.length === 0)}
    <div class="chat-generation-loading" data-generation-projection-loading={isGenerationProjection ? '' : undefined}>
    </div>
  {:else}
    {message || msgDisplay}
    {#if isGenerationLoading && isGenerationProjection}
      <div class="chat-generation-loading" data-generation-projection-loading></div>
    {/if}
  {/if}
</div>
{#if halfStreamingTokensPerSecond !== undefined}
  <div data-testid="half-streaming-throughput">{halfStreamingTokensPerSecond}</div>
{/if}
{#if halfStreamingGeneratedTokens !== undefined}
  <div data-testid="half-streaming-token-count">{halfStreamingGeneratedTokens}</div>
{/if}
