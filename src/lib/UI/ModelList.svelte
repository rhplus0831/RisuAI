<script lang="ts">
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import { getHordeModels } from 'src/ts/horde/getModels'
  import Accordion from './Accordion.svelte'
  import { language } from 'src/lang'
  import CheckInput from './GUI/CheckInput.svelte'
  import { getModelInfo, getModelList } from 'src/ts/model/modellist'
  import { ArrowLeft } from '@lucide/svelte'
  import { modalBackdropDismiss } from 'src/ts/gui/modalBackdropDismiss'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'

  interface Props {
    value?: string
    onChange?: (v: string) => void
    onclick?: (
      event: MouseEvent & {
        currentTarget: EventTarget & HTMLDivElement
      },
    ) => any
    blankable?: boolean
    excludesPrefix?: string
    noMargin?: boolean
  }

  let { value = $bindable(''), onChange = (v) => {}, onclick, blankable, excludesPrefix, noMargin }: Props = $props()
  let openOptions = $state(false)

  function changeModel(name: string) {
    value = name
    openOptions = false
    onChange(name)
  }

  function handlePickerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    openOptions = false
  }

  let showUnrec = $state(false)
  let providers = $derived(
    getModelList({
      recommendedOnly: !showUnrec,
      groupedByProvider: true,
    }),
  )

  function providerIdentity(provider: (typeof providers)[number]): string {
    if (provider.providerName !== '@as-is') return `provider:${provider.providerName}`
    return `as-is:${provider.models.map((model) => model.id).join('\u0000')}`
  }
</script>

{#if openOptions}
  <!-- Backdrop click is supplemental to the dialog's Back button and Escape handling. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    use:modalBackdropDismiss={() => {
      openOptions = false
    }}
    data-modal-root
    class="fixed top-0 w-full h-full left-0 bg-black/50 z-50 flex justify-center items-center">
    <div
      use:modalFocusTrap
      class="w-96 max-w-full max-h-full overflow-y-auto overflow-x-hidden bg-bgcolor p-4 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="risu-model-picker-title"
      tabindex="-1"
      onkeydown={handlePickerKeydown}
      onclick={(e) => {
        e.stopPropagation()
        onclick?.(e)
      }}>
      <div class="flex items-center gap-3 mb-4">
        <button
          data-modal-initial-focus
          class="flex items-center justify-center p-2 rounded-lg hover:bg-selected transition-colors shrink-0"
          onclick={() => {
            openOptions = false
          }}
          title="Back">
          <ArrowLeft size={20} />
        </button>
        <h2 id="risu-model-picker-title" class="font-bold text-xl flex-1">{language.model}</h2>
      </div>
      <div class="border-t-1 border-y-selected mb-2"></div>

      {#each providers as provider (providerIdentity(provider))}
        {#if provider.providerName === '@as-is'}
          {#each provider.models as model}
            <button
              class="hover:bg-selected px-6 py-2 text-lg"
              onclick={() => {
                changeModel(model.id)
              }}>{model.name}</button>
          {/each}
        {:else}
          <Accordion name={provider.providerName}>
            {#each provider.models.filter((m) => !excludesPrefix || !m.id.startsWith(excludesPrefix)) as model}
              <button
                class="hover:bg-selected px-6 py-2 text-lg"
                onclick={() => {
                  changeModel(model.id)
                }}>{model.name}</button>
            {/each}
          </Accordion>
        {/if}
      {/each}
      <Accordion name="Horde">
        {#await getHordeModels()}
          <button class="p-2">Loading...</button>
        {:then models}
          <button
            onclick={() => {
              changeModel('horde:::' + 'auto')
            }}
            class="p-2 hover:text-green-500">
            Auto Model
            <br /><span class="text-textcolor2 text-sm">Performace: Auto</span>
          </button>
          {#each models as model}
            <button
              onclick={() => {
                changeModel('horde:::' + model.name)
              }}
              class="p-2 hover:text-green-500">
              {model.name.trim()}
              <br /><span class="text-textcolor2 text-sm">Performace: {model.performance.toFixed(1)}</span>
            </button>
          {/each}
        {/await}
      </Accordion>

      {#if getDatabase().customModels?.length > 0}
        <Accordion name={language.customModels}>
          {#each getDatabase().customModels as model}
            <button
              class="hover:bg-selected px-6 py-2 text-lg"
              onclick={() => {
                changeModel(model.id)
              }}>{model.name ?? 'Unnamed'}</button>
          {/each}
        </Accordion>
      {/if}

      {#if blankable}
        <button
          class="hover:bg-selected px-6 py-2 text-lg"
          onclick={() => {
            changeModel('')
          }}>{language.none}</button>
      {/if}
      <div class="text-textcolor2 text-xs">
        <CheckInput name={language.showUnrecommended} grayText bind:check={showUnrec} />
      </div>
    </div>
  </div>
{/if}

<button
  onclick={() => {
    openOptions = true
  }}
  class={{
    'drop-shadow-lg p-3 flex justify-center items-center ml-2 mr-2 rounded-lg bg-darkbutton border-darkborderc border': true,
    'my-4': !noMargin,
  }}>
  {getModelInfo(value)?.fullName || language.none}
</button>
