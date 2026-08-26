<script lang="ts">
  import type { customscript } from 'src/ts/storage/database.svelte'
  import RegexData from './RegexData.svelte'
  import Sortable from 'sortablejs'
  import { sleep, sortableOptions } from 'src/ts/util'
  import { onDestroy, onMount } from 'svelte'
  import { DownloadIcon, HardDriveUploadIcon, PlusIcon } from '@lucide/svelte'
  import { exportRegex, importRegexRows } from 'src/ts/process/scripts'
  import {
    REGEX_DISPLAY_ACTIVATION_DELAY_MS,
    RegexDisplayActivationPending,
    cancelRegexDisplayActivation,
    regexDisplayDefinitionSignature,
    regexEditorActivitySignature,
    scheduleRegexDisplayActivation,
  } from 'src/ts/process/regexDisplayActivation'
  import { normalizeRegexDisplayOwnerKey } from 'src/ts/process/regexDisplayReload'
  import { language } from 'src/lang'
  interface Props {
    value?: customscript[]
    buttons?: boolean
    ownerKey?: string
  }

  let { value = $bindable([]), buttons = false, ownerKey = '' }: Props = $props()
  let stb: Sortable = null
  let ele: HTMLDivElement = $state()
  let sorted = $state(0)
  let opened = 0
  let destroyed = false
  let displaySignatureInitialized = false
  let displaySignatureOwner = ''
  let previousDisplaySignature = ''
  let previousActivitySignature = ''

  let normalizedOwnerKey = $derived(normalizeRegexDisplayOwnerKey(ownerKey))
  let displayActivation = $derived($RegexDisplayActivationPending[normalizedOwnerKey])
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

  const importRows = async () => {
    const importOwnerKey = ownerKey
    const importValue = value
    const importedRows = await importRegexRows()
    if (ownerKey !== importOwnerKey || value !== importValue || !importedRows || importedRows.length === 0) return
    value = [...value, ...importedRows]
  }

  onMount(createStb)

  $effect(() => {
    const nextOwner = normalizeRegexDisplayOwnerKey(ownerKey)
    const nextDisplaySignature = regexDisplayDefinitionSignature(value)
    const nextActivitySignature = regexEditorActivitySignature(value)

    if (!displaySignatureInitialized || nextOwner !== displaySignatureOwner) {
      if (displaySignatureInitialized && nextOwner !== displaySignatureOwner) {
        cancelRegexDisplayActivation(displaySignatureOwner)
      }
      displaySignatureInitialized = true
      displaySignatureOwner = nextOwner
      previousDisplaySignature = nextDisplaySignature
      previousActivitySignature = nextActivitySignature
      return
    }

    const displayChanged = nextDisplaySignature !== previousDisplaySignature
    const editorActivityChanged = nextActivitySignature !== previousActivitySignature
    previousDisplaySignature = nextDisplaySignature
    previousActivitySignature = nextActivitySignature

    if (displayChanged || (displayActivation && editorActivityChanged)) {
      scheduleRegexDisplayActivation(nextOwner)
    }
  })

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
{#if displayActivation}
  <div
    class="mt-2 flex flex-col gap-1 text-xs text-textcolor2"
    data-risu-regex-display-pending
    role="status"
    aria-live="polite">
    <span>{language.regexDisplayUpdatePending}</span>
    <div
      class="h-1 w-full overflow-hidden rounded-full bg-darkborderc"
      role="progressbar"
      aria-label={language.regexDisplayUpdatePending}>
      {#key displayActivation.run}
        <div
          class="regex-display-progress h-full origin-left rounded-full bg-selected"
          style={`animation-duration: ${REGEX_DISPLAY_ACTIVATION_DELAY_MS}ms`}>
        </div>
      {/key}
    </div>
  </div>
{/if}
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
      onclick={importRows}><HardDriveUploadIcon /></button>
  </div>
{/if}

<style>
  .regex-display-progress {
    animation-name: regex-display-progress-fill;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }

  @keyframes regex-display-progress-fill {
    from {
      transform: scaleX(0);
    }
    to {
      transform: scaleX(1);
    }
  }
</style>
