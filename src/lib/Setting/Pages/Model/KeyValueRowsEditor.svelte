<script lang="ts">
  import { PlusIcon, TrashIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import { confirmSettingsItemRemoval } from 'src/ts/setting/confirmSettingsItemRemoval'

  interface KeyValueRow {
    key: string
    value: string
  }

  interface Props {
    rows: KeyValueRow[]
    keyPlaceholder?: string
    valuePlaceholder?: string
    addLabel?: string
    emptyLabel?: string
  }

  let {
    rows = $bindable(),
    keyPlaceholder = '',
    valuePlaceholder = '',
    addLabel = language.add,
    emptyLabel = language.none,
  }: Props = $props()

  function setRow(index: number, patch: Partial<KeyValueRow>): void {
    rows = rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row))
  }

  function addRow(): void {
    rows = [...rows, { key: '', value: '' }]
  }

  function removeRow(index: number): void {
    if (!confirmSettingsItemRemoval()) return
    rows = rows.filter((_, rowIndex) => rowIndex !== index)
  }
</script>

<div class="flex flex-col gap-2">
  {#each rows as row, index}
    <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] items-center gap-2">
      <TextInput
        size="sm"
        fullwidth
        value={row.key}
        placeholder={keyPlaceholder}
        oninput={(event) => {
          setRow(index, { key: event.currentTarget.value })
        }} />
      <TextInput
        size="sm"
        fullwidth
        value={row.value}
        placeholder={valuePlaceholder}
        oninput={(event) => {
          setRow(index, { value: event.currentTarget.value })
        }} />
      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded-md bg-red-700 text-white hover:bg-red-500"
        aria-label={language.remove}
        onclick={() => {
          removeRow(index)
        }}>
        <TrashIcon size={16} />
      </button>
    </div>
  {/each}

  {#if rows.length === 0}
    <span class="text-sm text-textcolor2">{emptyLabel}</span>
  {/if}

  <div>
    <Button size="sm" styled="outlined" onclick={addRow}>
      <span class="inline-flex items-center gap-2"><PlusIcon size={16} />{addLabel}</span>
    </Button>
  </div>
</div>
