<script lang="ts">
  import { LoaderCircleIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import {
    agentPresetProgress,
    getAgentPresetProgressPercent,
    type ActiveAgentPresetProgress,
  } from 'src/ts/process/agentPresetProgress'
  import { getSelectedCharacterOwner } from 'src/ts/characterState'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import { selectedCharID } from 'src/ts/stores.svelte'

  let activeChatId = $derived.by(() => {
    const character = getSelectedCharacterOwner() ?? getDatabase().characters?.[$selectedCharID]
    return character?.chats?.[character.chatPage]?.id ?? ''
  })
  let progress = $derived.by(() => {
    return $agentPresetProgress.find((entry) => entry.chatId === activeChatId) ?? null
  })
  let progressPercent = $derived(progress ? getAgentPresetProgressPercent(progress) : 0)
  let progressLabel = $derived(progress ? labelForProgress(progress) : '')
  let activeStepLabel = $derived(progress ? activeStepsForProgress(progress) : '')

  function labelForProgress(value: ActiveAgentPresetProgress): string {
    const phase =
      value.phase === 'beforeMain' ? language.agentPresets.progressBeforeMain : language.agentPresets.progressAfterMain
    return language.agentPresets.progressLabel(
      value.presetName || value.presetId,
      phase,
      value.completedSteps,
      value.totalSteps,
    )
  }

  function activeStepsForProgress(value: ActiveAgentPresetProgress): string {
    const names = value.activeSteps.map((step) => step.stepName || step.outputKey).filter(Boolean)
    return names.length > 0
      ? language.agentPresets.progressActiveSteps(names.join(', '))
      : language.agentPresets.progressWaiting
  }
</script>

{#if progress}
  <div class="agent-preset-progress" role="status" aria-live="polite" aria-busy="true">
    <div class="agent-preset-progress-header">
      <LoaderCircleIcon size={15} class="risu-ongoing-pulse animate-spin shrink-0" />
      <span>{progressLabel}</span>
    </div>
    <div class="agent-preset-progress-detail">{activeStepLabel}</div>
    <div
      class="agent-preset-progress-track"
      role="progressbar"
      aria-label={progressLabel}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={progressPercent}>
      <div
        class:agent-preset-progress-fill-before={progress.phase === 'beforeMain'}
        class:agent-preset-progress-fill-after={progress.phase === 'afterMain'}
        class="risu-ongoing-pulse agent-preset-progress-fill"
        style:width={`${progressPercent}%`}>
      </div>
    </div>
  </div>
{/if}

<style>
  .agent-preset-progress {
    width: min(34rem, calc(100% - 2rem));
    margin: 0.25rem auto 0.75rem;
    color: var(--risu-theme-textcolor2);
  }

  .agent-preset-progress-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 1.25rem;
    font-size: 0.8125rem;
    line-height: 1.2rem;
  }

  .agent-preset-progress-header span,
  .agent-preset-progress-detail {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-preset-progress-detail {
    margin-top: 0.125rem;
    font-size: 0.75rem;
    opacity: 0.8;
  }

  .agent-preset-progress-track {
    position: relative;
    height: 0.375rem;
    margin-top: 0.375rem;
    overflow: hidden;
    border: 1px solid var(--risu-theme-darkborderc);
    border-radius: 9999px;
    background: color-mix(in srgb, var(--risu-theme-darkbg) 84%, transparent);
  }

  .agent-preset-progress-fill {
    position: relative;
    height: 100%;
    min-width: 1.75rem;
    border-radius: inherit;
    transition: width 0.35s ease;
  }

  .agent-preset-progress-fill-before {
    background: #60a5fa;
  }

  .agent-preset-progress-fill-after {
    background: #a78bfa;
  }

  .agent-preset-progress-fill::after {
    position: absolute;
    inset: 0;
    content: '';
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent);
    animation: agent-preset-progress-shine 1.2s ease-in-out infinite;
  }

  @keyframes agent-preset-progress-shine {
    0% {
      transform: translateX(-100%);
    }

    100% {
      transform: translateX(100%);
    }
  }

  :global(html.risu-reduced-motion) .agent-preset-progress-fill {
    transition: none;
  }

  :global(html.risu-reduced-motion) .agent-preset-progress-fill::after {
    animation: none;
  }
</style>
