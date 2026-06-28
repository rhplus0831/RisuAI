<script lang="ts">
  import { LoaderCircleIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import { postGenerationProgress, type ActivePostGenerationProgress } from 'src/ts/process/postGenerationProgress'
  import { getPostGenerationScriptProgress } from './chatGenerationLoading'

  let now = $state(Date.now())

  function ownerLabel(progress: ActivePostGenerationProgress): string {
    const rawName = progress.ownerName || progress.ownerId || language.chatPostGenerationProgressUnknownScript
    const owner =
      progress.ownerType === 'module'
        ? language.chatPostGenerationProgressModuleScript(rawName)
        : progress.ownerType === 'character'
          ? language.chatPostGenerationProgressCharacterScript(rawName)
          : rawName
    return progress.triggerComment
      ? language.chatPostGenerationProgressWithComment(owner, progress.triggerComment)
      : owner
  }

  function phaseLabel(progress: ActivePostGenerationProgress): string {
    return progress.phase === 'editOutput'
      ? language.chatPostGenerationProgressEditOutput
      : language.chatPostGenerationProgressOnOutput
  }

  let progressLabel = $derived.by(() => {
    const progress = $postGenerationProgress
    if (!progress) return ''
    return language.chatPostGenerationProgressLabel(
      ownerLabel(progress),
      phaseLabel(progress),
      progress.llmCallCount,
      progress.pendingLlmCount,
    )
  })

  let progressPercent = $derived.by(() => {
    const progress = $postGenerationProgress
    return progress ? getPostGenerationScriptProgress(progress.startedAt, now, progress.llmCallCount) : 0
  })

  $effect(() => {
    if (!$postGenerationProgress) return
    now = Date.now()
    const timer = setInterval(() => {
      now = Date.now()
    }, 450)
    return () => clearInterval(timer)
  })
</script>

{#if $postGenerationProgress}
  <div class="post-generation-progress" role="status" aria-live="polite" aria-busy="true">
    <div class="post-generation-progress-header">
      <LoaderCircleIcon size={15} class="animate-spin shrink-0" />
      <span>{progressLabel}</span>
    </div>
    <div class="post-generation-progress-track">
      <div class="post-generation-progress-fill" style:width={`${progressPercent}%`}></div>
    </div>
  </div>
{/if}

<style>
  .post-generation-progress {
    width: min(34rem, calc(100% - 2rem));
    margin: 0.25rem auto 0.75rem;
    color: var(--risu-theme-textcolor2);
  }

  .post-generation-progress-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 1.25rem;
    font-size: 0.8125rem;
    line-height: 1.2rem;
  }

  .post-generation-progress-header span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .post-generation-progress-track {
    position: relative;
    height: 0.375rem;
    margin-top: 0.375rem;
    overflow: hidden;
    border: 1px solid var(--risu-theme-darkborderc);
    border-radius: 9999px;
    background: color-mix(in srgb, var(--risu-theme-darkbg) 84%, transparent);
  }

  .post-generation-progress-fill {
    position: relative;
    height: 100%;
    min-width: 1.75rem;
    border-radius: inherit;
    background: #22c55e;
    transition: width 0.45s ease;
  }

  .post-generation-progress-fill::after {
    position: absolute;
    inset: 0;
    content: '';
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent);
    animation: post-generation-progress-shine 1.2s ease-in-out infinite;
  }

  @keyframes post-generation-progress-shine {
    0% {
      transform: translateX(-100%);
    }

    100% {
      transform: translateX(100%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .post-generation-progress-fill,
    .post-generation-progress-fill::after {
      animation: none;
      transition: none;
    }
  }
</style>
