<script lang="ts">
  import type { SerializableHypaV3Data } from 'src/ts/process/memory/hypav3'
  import type { ServerSummaryPatchField } from './server-summary-patch'
  import TagManagerModal from './tag-manager-modal.svelte'

  interface Props {
    onSummaryChanged?: (index: number, field: ServerSummaryPatchField) => void | Promise<unknown>
  }

  let { onSummaryChanged }: Props = $props()
  let tagManagerState = $state({
    isOpen: true,
    currentSummaryIndex: 0,
    currentSummaryId: undefined as string | undefined,
    editingTag: '',
    editingTagIndex: -1,
  })
  let hypaV3Data = $state<SerializableHypaV3Data>({
    summaries: [{ text: 'Summary', chatMemos: [], tags: ['foo', 'bar'], isImportant: false }],
    categories: [],
    lastSelectedSummaries: [],
  })

  export function getTags(): string[] {
    return [...(hypaV3Data.summaries[0]?.tags ?? [])]
  }
</script>

<TagManagerModal bind:tagManagerState {hypaV3Data} {onSummaryChanged} />
