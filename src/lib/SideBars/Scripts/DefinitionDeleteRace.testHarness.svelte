<script lang="ts">
  import RegexList from './RegexList.svelte'
  import TriggerV1List from './TriggerV1List.svelte'
  import type { customscript, triggerscript } from 'src/ts/storage/database.svelte'

  interface Props {
    kind: 'regex' | 'trigger'
  }

  let { kind }: Props = $props()
  let scripts = $state<customscript[]>([
    { id: 'script-a', comment: 'A', in: '', out: '', type: 'editinput' },
    { id: 'script-b', comment: 'B', in: '', out: '', type: 'editinput' },
  ])
  let triggers = $state<triggerscript[]>([
    { id: 'trigger-a', comment: 'A', type: 'start', conditions: [], effect: [] },
    { id: 'trigger-b', comment: 'B', type: 'start', conditions: [], effect: [] },
  ])

  function applyReorderedProjection(): void {
    if (kind === 'regex') {
      scripts = [scripts[1], scripts[0]].map((script) => ({ ...script }))
      return
    }
    triggers = [triggers[1], triggers[0]].map((trigger) => ({ ...trigger }))
  }

  function applyProjectionWithoutTarget(): void {
    if (kind === 'regex') {
      scripts = scripts.filter((script) => script.id === 'script-b').map((script) => ({ ...script }))
      return
    }
    triggers = triggers.filter((trigger) => trigger.id === 'trigger-b').map((trigger) => ({ ...trigger }))
  }
</script>

<button data-testid="reorder" onclick={applyReorderedProjection}>Reorder</button>
<button data-testid="remove-target" onclick={applyProjectionWithoutTarget}>Remove target</button>

{#if kind === 'regex'}
  <RegexList bind:value={scripts} />
  <output data-testid="ids">{scripts.map((script) => script.id).join(',')}</output>
{:else}
  <TriggerV1List bind:value={triggers} />
  <output data-testid="ids">{triggers.map((trigger) => trigger.id).join(',')}</output>
{/if}
