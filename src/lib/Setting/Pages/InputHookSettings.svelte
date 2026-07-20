<script lang="ts">
  import { PlusIcon, TrashIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte'
  import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte'
  import TextAreaInput from 'src/lib/UI/GUI/TextAreaInput.svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import { createNonSecurityUuid } from 'src/ts/nonSecurityUuid'
  import { createServerBackedSettingDraft } from 'src/ts/server/settingsBridge.svelte'
  import type { InputHook } from 'src/ts/storage/database.svelte'
  import { createDefaultInputHooks } from 'src/ts/storage/defaultPrompts'

  const inputHooksDraft = createServerBackedSettingDraft<InputHook[]>('inputHooks', createDefaultInputHooks())
  let newHookType = $state<InputHook['type']>('draft')

  function updateHooks(updater: (hooks: InputHook[]) => void): void {
    const hooks = inputHooksDraft.value.map((hook) => ({ ...hook }))
    updater(hooks)
    inputHooksDraft.value = hooks
  }

  function updateHook(index: number, patch: Partial<InputHook>): void {
    updateHooks((hooks) => {
      if (!hooks[index]) return
      hooks[index] = { ...hooks[index], ...patch }
    })
  }

  function addHook(): void {
    updateHooks((hooks) => {
      hooks.push({
        id: createNonSecurityUuid(),
        name: newHookType === 'draft' ? language.inputHookTypeDraft : language.inputHookTypeBtw,
        type: newHookType,
        prompt: '',
      })
    })
  }

  function deleteHook(index: number): void {
    updateHooks((hooks) => {
      hooks.splice(index, 1)
    })
  }
</script>

<section class="flex flex-col gap-4" data-risu-input-hook-settings>
  <h2 class="mb-1 mt-2 text-2xl font-bold">{language.inputHooks}</h2>

  <div class="flex flex-wrap items-center gap-2">
    <SelectInput bind:value={newHookType} ariaLabel={language.type}>
      <OptionInput value="draft">{language.inputHookTypeDraft}</OptionInput>
      <OptionInput value="btw">{language.inputHookTypeBtw}</OptionInput>
    </SelectInput>
    <Button onclick={addHook} ariaLabel={language.inputHookAdd}>
      <span class="inline-flex items-center gap-2"><PlusIcon size={16} />{language.inputHookAdd}</span>
    </Button>
  </div>

  {#each inputHooksDraft.value as hook, index (hook.id)}
    <article class="flex flex-col gap-3 rounded-md border border-darkborderc p-4">
      <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.inputHookName}</span>
          <TextInput
            fullwidth
            ariaLabel={language.inputHookName}
            bind:value={
              () => inputHooksDraft.value[index]?.name ?? '', (value) => updateHook(index, { name: value })
            } />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.type}</span>
          <SelectInput
            value={hook.type}
            ariaLabel={language.type}
            onchange={(event) => updateHook(index, { type: event.currentTarget.value as InputHook['type'] })}>
            <OptionInput value="draft">{language.inputHookTypeDraft}</OptionInput>
            <OptionInput value="btw">{language.inputHookTypeBtw}</OptionInput>
          </SelectInput>
        </label>
        <Button
          styled="danger"
          ariaLabel={`${language.inputHookDelete}: ${hook.name}`}
          onclick={() => deleteHook(index)}>
          <span class="inline-flex items-center gap-2"><TrashIcon size={16} />{language.inputHookDelete}</span>
        </Button>
      </div>

      <label class="flex flex-col gap-1">
        <span class="text-sm text-textcolor2">{language.inputHookPrompt}</span>
        <TextAreaInput
          fullwidth
          height="28"
          ariaLabel={language.inputHookPrompt}
          bind:value={
            () => inputHooksDraft.value[index]?.prompt ?? '', (value) => updateHook(index, { prompt: value })
          } />
      </label>
    </article>
  {/each}
</section>
