<script lang="ts">
  import type { triggerscript } from 'src/ts/storage/database.svelte'
  import TriggerList from './TriggerList.svelte'

  interface Props {
    initialMode: 'v1' | 'v2'
  }

  let { initialMode }: Props = $props()
  let ownerKey = $state('character:a')
  let value = $state<triggerscript[]>(
    initialMode === 'v2'
      ? [
          {
            id: 'original',
            comment: 'Original V2',
            type: 'manual',
            conditions: [],
            effect: [{ type: 'v2Header', code: '', indent: 0 }],
          },
        ]
      : [
          {
            id: 'original',
            comment: 'Original V1',
            type: 'start',
            conditions: [],
            effect: [],
          },
        ],
  )

  function replaceProjection(): void {
    value = [
      {
        id: 'newer',
        comment: 'Newer projection',
        type: initialMode === 'v2' ? 'manual' : 'start',
        conditions: [],
        effect: initialMode === 'v2' ? [{ type: 'v2Header', code: 'newer', indent: 0 }] : [],
      },
    ]
  }
</script>

<button data-testid="replace-projection" onclick={replaceProjection}>Replace projection</button>
<button data-testid="replace-owner" onclick={() => (ownerKey = 'character:b')}>Replace owner</button>
<TriggerList bind:value {ownerKey} lowLevelAble />
<output data-testid="trigger-value">{JSON.stringify(value)}</output>
