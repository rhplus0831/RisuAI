<script lang="ts">
  import { SaveIcon, XIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Help from 'src/lib/Others/Help.svelte'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
  import NumberInput from 'src/lib/UI/GUI/NumberInput.svelte'
  import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'
  import {
    AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MAX,
    AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MIN,
    AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MAX,
    AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MIN,
    AGENT_PRESET_RUNTIME_TEMPERATURE_MAX,
    AGENT_PRESET_RUNTIME_TEMPERATURE_MIN,
    AGENT_PRESET_RUNTIME_TIMEOUT_MS_MAX,
    AGENT_PRESET_RUNTIME_TIMEOUT_MS_MIN,
    AGENT_PRESET_STEP_INPUT_SCOPES,
    type AgentPresetStepInputScope,
    type AgentPresetStepModelSelection,
    type AgentPresetStepOutputFormat,
    type AgentRecord,
  } from 'src/ts/agentPresetRecords'
  import type { AgentSnapshot } from 'src/ts/server/commands'
  import { getDatabase } from 'src/ts/storage/database.svelte'

  interface Props {
    mode: 'create' | 'edit'
    agent?: AgentRecord
    busy?: boolean
    commandError?: string
    onSave: (agent: AgentSnapshot) => void | Promise<void>
    onCancel: () => void
  }

  const TEMPERATURE_SCALE = 100
  let { mode, agent, busy = false, commandError = '', onSave, onCancel }: Props = $props()
  // svelte-ignore state_referenced_locally
  const initial = agent
  let name = $state(initial?.name ?? language.agentPresets.newAgentName)
  let description = $state(initial?.description ?? '')
  let instruction = $state(initial?.instruction ?? '')
  let modelMode = $state<AgentPresetStepModelSelection['mode']>(initial?.modelDefaults.mode ?? 'inheritMain')
  let profileId = $state(initial?.modelDefaults.mode === 'modelProfile' ? initial.modelDefaults.profileId : '')
  let outputFormat = $state<AgentPresetStepOutputFormat>(initial?.outputFormat ?? 'text')
  let timeoutMs = $state(initial?.runtimeDefaults.timeoutMs ?? 30_000)
  let maxInputChars = $state(initial?.runtimeDefaults.maxInputChars ?? 24_000)
  let maxOutputChars = $state(initial?.runtimeDefaults.maxOutputChars ?? 1_200)
  let temperature = $state((initial?.runtimeDefaults.temperature ?? 100) / TEMPERATURE_SCALE)
  let structuredOutputStrict = $state(initial?.runtimeDefaults.structuredOutputStrict ?? false)
  let inputScopes = $state<AgentPresetStepInputScope[]>(
    initial?.inputScopes ? [...initial.inputScopes] : ['currentUserMessage'],
  )
  let modelProfiles = $derived(Array.isArray(getDatabase().modelProfiles) ? getDatabase().modelProfiles : [])
  const initialSnapshot = agentSnapshotFromRecord(initial)
  let snapshot = $derived(agentSnapshot())
  let dirty = $derived(JSON.stringify(snapshot) !== JSON.stringify(initialSnapshot))
  let canSave = $derived(
    name.trim().length > 0 &&
      (modelMode === 'inheritMain' || profileId.trim().length > 0) &&
      !busy &&
      (mode === 'create' || dirty),
  )

  function agentSnapshot(): AgentSnapshot {
    const modelDefaults: AgentPresetStepModelSelection =
      modelMode === 'modelProfile' ? { mode: 'modelProfile', profileId: profileId.trim() } : { mode: 'inheritMain' }
    return {
      name: name.trim(),
      description: description.trim() || null,
      instruction,
      modelDefaults,
      runtimeDefaults: {
        timeoutMs: clamp(timeoutMs, AGENT_PRESET_RUNTIME_TIMEOUT_MS_MIN, AGENT_PRESET_RUNTIME_TIMEOUT_MS_MAX),
        maxInputChars: clamp(
          maxInputChars,
          AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MIN,
          AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MAX,
        ),
        maxOutputChars: clamp(
          maxOutputChars,
          AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MIN,
          AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MAX,
        ),
        temperature: clamp(
          Math.round(Number(temperature) * TEMPERATURE_SCALE),
          AGENT_PRESET_RUNTIME_TEMPERATURE_MIN,
          AGENT_PRESET_RUNTIME_TEMPERATURE_MAX,
        ),
        structuredOutputStrict,
      },
      inputScopes: [...inputScopes],
      outputFormat,
    }
  }

  function agentSnapshotFromRecord(record: AgentRecord | undefined): AgentSnapshot {
    if (!record) return agentSnapshot()
    return {
      name: record.name,
      description: record.description ?? null,
      instruction: record.instruction,
      modelDefaults: record.modelDefaults,
      runtimeDefaults: {
        timeoutMs: record.runtimeDefaults.timeoutMs ?? 30_000,
        maxInputChars: record.runtimeDefaults.maxInputChars ?? 24_000,
        maxOutputChars: record.runtimeDefaults.maxOutputChars ?? 1_200,
        temperature: record.runtimeDefaults.temperature ?? 100,
        structuredOutputStrict: record.runtimeDefaults.structuredOutputStrict ?? false,
      },
      inputScopes: [...record.inputScopes],
      outputFormat: record.outputFormat,
    }
  }

  function sparseSnapshot(): AgentSnapshot {
    if (mode === 'create' || !initial) return snapshot
    return Object.fromEntries(
      Object.entries(snapshot).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(initialSnapshot[key])),
    ) as AgentSnapshot
  }

  function toggleScope(scope: AgentPresetStepInputScope, checked: boolean): void {
    inputScopes = checked
      ? [...new Set([...inputScopes, scope])]
      : inputScopes.filter((candidate) => candidate !== scope)
  }

  function clamp(value: unknown, min: number, max: number): number {
    const number = Math.round(Number(value))
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min
  }

  function requestClose(): void {
    if (busy) return
    if (dirty && !window.confirm(language.agentPresets.discardChangesConfirm)) return
    onCancel()
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div data-modal-root role="presentation" class="fixed inset-0 z-50 flex justify-end bg-black/50" onclick={requestClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    use:modalFocusTrap
    class="flex h-full w-full max-w-3xl flex-col border-l border-darkborderc bg-bgcolor text-textcolor shadow-xl"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-busy={busy}
    data-risu-agent-editor
    onclick={(event) => event.stopPropagation()}>
    <div class="flex items-center justify-between border-b border-darkborderc p-4">
      <h3 class="text-xl font-semibold">
        {mode === 'create' ? language.agentPresets.createAgent : language.agentPresets.editAgent}
      </h3>
      <Button size="sm" styled="outlined" disabled={busy} onclick={requestClose}><XIcon size={16} /></Button>
    </div>
    <div class="flex-1 overflow-y-auto p-4">
      {#if commandError}<div class="mb-3 rounded-md border border-draculared p-3 text-sm text-draculared">
          {commandError}
        </div>{/if}
      <div class="grid gap-3 md:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="text-sm font-medium">{language.agentPresets.nameLabel}</span>
          <TextInput bind:value={name} fullwidth />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm font-medium">{language.agentPresets.outputFormatLabel}</span>
          <SelectInput bind:value={outputFormat} className="w-full">
            <option value="text">{language.agentPresets.outputFormatText}</option>
            <option value="jsonObject">{language.agentPresets.outputFormatJsonObject}</option>
          </SelectInput>
        </label>
      </div>
      <label class="mt-3 flex flex-col gap-1">
        <span class="text-sm font-medium">{language.agentPresets.descriptionLabel}</span>
        <textarea
          class="min-h-20 rounded-md border border-darkborderc bg-transparent px-3 py-2 text-sm"
          bind:value={description}></textarea>
      </label>
      <label class="mt-3 flex flex-col gap-1">
        <span class="text-sm font-medium">{language.agentPresets.instructionLabel}</span>
        <textarea
          class="min-h-36 rounded-md border border-darkborderc bg-transparent px-3 py-2 text-sm"
          bind:value={instruction}></textarea>
      </label>
      <div class="mt-3 grid gap-3 md:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="text-sm font-medium">{language.agentPresets.modelModeLabel}</span>
          <SelectInput bind:value={modelMode} className="w-full">
            <option value="inheritMain">{language.agentPresets.inheritMainModel}</option>
            <option value="modelProfile">{language.agentPresets.selectedModelProfile}</option>
          </SelectInput>
        </label>
        {#if modelMode === 'modelProfile'}
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">{language.agentPresets.modelProfileLabel}</span>
            <SelectInput bind:value={profileId} className="w-full">
              <option value="">{language.agentPresets.noModelProfiles}</option>
              {#each modelProfiles as profile (profile.id)}<option value={profile.id}
                  >{profile.name ?? profile.id}</option
                >{/each}
            </SelectInput>
          </label>
        {/if}
      </div>
      <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label class="flex flex-col gap-1"
          ><span class="text-sm">{language.agentPresets.timeoutMsLabel}</span><NumberInput
            bind:value={timeoutMs}
            min={AGENT_PRESET_RUNTIME_TIMEOUT_MS_MIN}
            max={AGENT_PRESET_RUNTIME_TIMEOUT_MS_MAX}
            fullwidth /></label>
        <label class="flex flex-col gap-1"
          ><span class="text-sm">{language.agentPresets.maxInputCharsLabel}</span><NumberInput
            bind:value={maxInputChars}
            min={AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MIN}
            max={AGENT_PRESET_RUNTIME_MAX_INPUT_CHARS_MAX}
            fullwidth /></label>
        <label class="flex flex-col gap-1"
          ><span class="text-sm">{language.agentPresets.maxOutputCharsLabel}</span><NumberInput
            bind:value={maxOutputChars}
            min={AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MIN}
            max={AGENT_PRESET_RUNTIME_MAX_OUTPUT_CHARS_MAX}
            fullwidth /></label>
        <label class="flex flex-col gap-1"
          ><span class="text-sm">{language.agentPresets.temperatureLabel}</span><NumberInput
            bind:value={temperature}
            min={0}
            max={2}
            step={0.01}
            fullwidth /></label>
      </div>
      <div class="mt-3">
        <CheckInput
          bind:check={structuredOutputStrict}
          name={language.agentPresets.structuredOutputStrict}
          onChange={(value) => (structuredOutputStrict = value)} />
      </div>
      <div class="mt-4 rounded-md border border-darkborderc p-3">
        <h4 class="inline-flex items-center gap-1 text-sm font-semibold">
          {language.agentPresets.preparedInputScopesLabel}
          <Help key="agentPresetPreparedInputs" name={language.agentPresets.preparedInputScopesLabel} />
        </h4>
        <p class="mt-1 text-xs text-textcolor2">{language.agentPresets.preparedInputScopesDescription}</p>
        <div class="mt-3 grid gap-2 sm:grid-cols-2">
          {#each AGENT_PRESET_STEP_INPUT_SCOPES as scope (scope)}
            <div class="rounded-md border border-darkborderc p-2">
              <CheckInput
                check={inputScopes.includes(scope)}
                name={language.agentPresets.inputScopeLabels[scope]}
                onChange={(checked) => toggleScope(scope, checked)} />
              <p class="pl-7 text-xs text-textcolor2">{language.agentPresets.inputScopeDescriptions[scope]}</p>
            </div>
          {/each}
        </div>
      </div>
    </div>
    <div class="flex justify-end gap-2 border-t border-darkborderc p-4">
      <Button styled="outlined" disabled={busy} onclick={requestClose}>{language.agentPresets.cancel}</Button>
      <Button disabled={!canSave} onclick={() => onSave(sparseSnapshot())}>
        <span class="inline-flex items-center gap-2"
          ><SaveIcon size={16} />{busy ? language.agentPresets.saving : language.agentPresets.save}</span>
      </Button>
    </div>
  </div>
</div>
