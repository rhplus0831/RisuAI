<script lang="ts">
  import type { customscript } from 'src/ts/storage/database.svelte'
  import RegexData from './RegexData.svelte'
  import Sortable from 'sortablejs'
  import { sleep, sortableOptions } from 'src/ts/util'
  import { onDestroy, onMount } from 'svelte'
  import { DownloadIcon, HardDriveUploadIcon, PlusIcon } from '@lucide/svelte'
  import { exportRegex, importRegexRows } from 'src/ts/process/scripts'
  import { language } from 'src/lang'
  interface Props {
    value?: customscript[]
    buttons?: boolean
  }

  let { value = $bindable([]), buttons = false }: Props = $props()
  let stb: Sortable = null
  let ele: HTMLDivElement = $state()
  let sorted = $state(0)
  let opened = 0
  let destroyed = false
  const createStb = () => {
    if (destroyed || !ele || opened > 0) return
    stb = Sortable.create(ele, {
      onEnd: async () => {
        let idx: number[] = []
        ele.querySelectorAll('[data-risu-idx]').forEach((e, i) => {
          idx.push(parseInt(e.getAttribute('data-risu-idx')))
        })
        let newValue: customscript[] = []
        idx.forEach((i) => {
          newValue.push(value[i])
        })
        value = newValue
        try {
          stb.destroy()
        } catch (error) {}
        sorted += 1
        await sleep(1)
        createStb()
      },
      ...sortableOptions,
    })
  }

  const onOpen = () => {
    if (destroyed) return
    opened += 1
    if (stb) {
      try {
        stb.destroy()
      } catch (error) {}
    }
  }
  const onClose = () => {
    opened = Math.max(0, opened - 1)
    if (opened === 0 && !destroyed) {
      createStb()
    }
  }

  const removeById = (targetId: string) => {
    const matchingIndices = value.flatMap((script, index) => (script.id === targetId ? [index] : []))
    if (matchingIndices.length !== 1) return
    value = value.filter((_, index) => index !== matchingIndices[0])
  }

  const rowKey = (script: customscript): string | customscript => {
    const id = script.id?.trim()
    if (!id) return script
    const idIsUnique = value.filter((candidate) => candidate.id?.trim() === id).length === 1
    return idIsUnique ? `regex:${id}` : script
  }

  onMount(createStb)

  onDestroy(() => {
    destroyed = true
    if (stb) {
      try {
        stb.destroy()
      } catch (error) {}
    }
    stb = null
  })
</script>

{#key sorted}
  <div
    class="contain w-full max-w-full mt-2 flex flex-col p-3 border-selected border-1 bg-darkbg rounded-md"
    bind:this={ele}>
    {#if value.length === 0}
      <div class="text-textcolor2">No Scripts</div>
    {/if}
    {#each value as customscript, i (rowKey(customscript))}
      <RegexData idx={i} bind:value={value[i]} {onOpen} {onClose} onRemove={removeById} />
    {/each}
  </div>
{/key}
{#if buttons}
  <div class="flex gap-2 mt-2">
    <button
      class="rounded-md text-textcolor2 hover:text-textcolor focus-within:text-textcolor"
      aria-label={`${language.add}: ${language.regexScript}`}
      onclick={() => {
        value.push({
          comment: '',
          in: '',
          out: '',
          type: 'editinput',
        })
      }}>
      <PlusIcon />
    </button>
    <button
      class="rounded-md text-textcolor2 hover:text-textcolor focus-within:text-textcolor"
      aria-label={`${language.export}: ${language.regexScript}`}
      onclick={() => {
        exportRegex(value)
      }}><DownloadIcon /></button>
    <button
      class="rounded-md text-textcolor2 hover:text-textcolor focus-within:text-textcolor"
      aria-label={`${language.import}: ${language.regexScript}`}
      onclick={async () => {
        const importedRows = await importRegexRows()
        if (!importedRows || importedRows.length === 0) return
        value = [...value, ...importedRows]
      }}><HardDriveUploadIcon /></button>
  </div>
{/if}
