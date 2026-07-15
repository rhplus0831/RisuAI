<script lang="ts">
  import type { language } from 'src/lang'
  import Help from '../Others/Help.svelte'

  let open = $state(false)
  interface Props {
    name?: string
    styled?: boolean
    help?: keyof typeof language.help | ''
    disabled?: boolean
    children?: import('svelte').Snippet
    className?: string
  }

  let { name = '', styled = false, help = '', disabled = false, children, className = '' }: Props = $props()
  const accordionId = $props.id()
  const triggerId = `${accordionId}-trigger`
  const panelId = `${accordionId}-panel`
</script>

{#if disabled}
  {@render children?.()}
{:else if styled}
  <div class="flex flex-col mt-2">
    <div
      class="hover:bg-selected rounded-t-md border-selected border flex items-center"
      class:bg-selected={open}
      class:rounded-b-md={!open}>
      <button
        id={triggerId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        class="min-w-0 grow px-6 py-2 text-left text-lg"
        onclick={() => {
          open = !open
        }}>
        <span>{name}</span>
      </button>
      {#if help}
        <span class="mr-6 shrink-0"><Help key={help} {name} /></span>
      {/if}
    </div>
    {#if open}
      <div
        id={panelId}
        role="region"
        aria-labelledby={triggerId}
        class={'flex flex-col border border-selected p-2 rounded-b-md ' + className}>
        {@render children?.()}
      </div>
    {/if}
  </div>
{:else}
  <div class="flex flex-col">
    <div class="hover:bg-selected flex items-center" class:bg-selected={open}>
      <button
        id={triggerId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        class="min-w-0 grow px-6 py-2 text-left text-lg"
        onclick={() => {
          open = !open
        }}>{name}</button>
      {#if help}
        <span class="mr-6 shrink-0"><Help key={help} {name} /></span>
      {/if}
    </div>
    {#if open}
      <div id={panelId} role="region" aria-labelledby={triggerId} class="flex flex-col bg-darkbg">
        {@render children?.()}
      </div>
    {/if}
  </div>
{/if}
