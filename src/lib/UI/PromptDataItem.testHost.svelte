<script lang="ts">
  import { untrack } from 'svelte'
  import type { PromptItem } from 'src/ts/process/prompt'
  import PromptDataItem from './PromptDataItem.svelte'

  let {
    initialPrompt = {
      type: 'cache',
      name: 'Cached context',
      depth: 1,
      role: 'all',
    },
  }: { initialPrompt?: PromptItem } = $props()
  let promptItem = $state<PromptItem>(untrack(() => JSON.parse(JSON.stringify(initialPrompt)) as PromptItem))
  let openedItemIndices = $state(new Set<number>())
</script>

<PromptDataItem
  bind:promptItem
  bind:openedItemIndices
  isOpened={openedItemIndices.has(0)}
  currentIndex={0}
  displayIndex={0} />
<span data-testid="opened-state">{openedItemIndices.has(0) ? 'open' : 'closed'}</span>
<span data-testid="prompt-json">{JSON.stringify(promptItem)}</span>
