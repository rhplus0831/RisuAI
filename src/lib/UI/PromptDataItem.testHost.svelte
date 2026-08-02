<script lang="ts">
  import type { PromptItem } from 'src/ts/process/prompt'
  import PromptDataItem from './PromptDataItem.svelte'

  let promptItem = $state<PromptItem>({
    type: 'cache',
    name: 'Cached context',
    depth: 1,
    role: 'all',
  })
  let openedItemIndices = $state(new Set<number>())
  let duplicateCount = $state(0)
</script>

<PromptDataItem
  bind:promptItem
  bind:openedItemIndices
  isOpened={openedItemIndices.has(0)}
  currentIndex={0}
  displayIndex={0}
  onDuplicate={() => {
    duplicateCount += 1
  }} />
<span data-testid="opened-state">{openedItemIndices.has(0) ? 'open' : 'closed'}</span>
<span data-testid="duplicate-count">{duplicateCount}</span>
