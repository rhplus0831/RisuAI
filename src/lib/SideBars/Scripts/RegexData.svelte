<script lang="ts">
  import { XIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import { alertConfirm } from 'src/ts/alert'
  import type { customscript } from 'src/ts/storage/database.svelte'
  import Check from '../../UI/GUI/CheckInput.svelte'
  import TextInput from '../../UI/GUI/TextInput.svelte'
  import TextAreaInput from '../../UI/GUI/TextAreaInput.svelte'
  import SelectInput from '../../UI/GUI/SelectInput.svelte'
  import OptionInput from '../../UI/GUI/OptionInput.svelte'
  import Accordion from 'src/lib/UI/Accordion.svelte'
  import NumberInput from 'src/lib/UI/GUI/NumberInput.svelte'
  import { v4 } from 'uuid'
  import { onDestroy } from 'svelte'
  import { serverUnsupportedRegexEffectType } from 'src/ts/process/triggerServerSupport'

  interface Props {
    value: customscript
    onRemove?: (targetId: string) => void
    onClose?: () => void
    onOpen?: () => void
    idx: number
  }

  let { value = $bindable(), onRemove = () => {}, onClose = () => {}, onOpen = () => {}, idx }: Props = $props()

  const currentFlag = () => value.flag ?? ''

  const checkFlagContain = (flag: string, matchFlag = currentFlag()) => {
    if (flag.length === 1) {
      matchFlag = currentFlag().replace(/<(.+?)>/g, '')
    }
    return matchFlag.includes(flag)
  }

  const toggleFlag = (flag: string) => {
    const existingFlag = currentFlag()
    if (checkFlagContain(flag, existingFlag)) {
      value.flag = existingFlag.replace(flag, '')
    } else {
      value.flag = existingFlag + flag
    }
  }

  const getOrder = (flag = currentFlag()) => {
    const order = flag.match(/<order (-?\d+)>/)?.[1]
    if (order === undefined || order === null) {
      return 0
    }
    return parseInt(order)
  }

  const changeOrder = (order: number) => {
    const existingFlag = currentFlag()
    if (existingFlag.includes('<order')) {
      value.flag = existingFlag.replace(/<order (-?\d+)>/, `<order ${order}>`)
    } else {
      value.flag = existingFlag + `<order ${order}>`
    }
  }

  const flags = [
    // JavaScript RegExp flags
    ['Global (g)', 'g'],
    ['Case Insensitive (i)', 'i'],
    ['Multi Line (m)', 'm'],
    ['Unicode (u)', 'u'],
    ['Dot All (s)', 's'],

    // Risu script flags
    ['Move Top', '<move_top>'],
    ['Move Bottom', '<move_bottom>'],
    ['Repeat Back', '<repeat_back>'],
    ['IN CBS Parsing', '<cbs>'],
    ['No Newline Subfix', '<no_end_nl>'],
  ]

  let open = $state(false)
  let deletionPending = $state(false)

  function closeOpenRegistration(): void {
    if (!open) return
    open = false
    onClose()
  }

  onDestroy(closeOpenRegistration)

  async function removeRow(): Promise<void> {
    if (deletionPending) return
    deletionPending = true
    try {
      const targetId = value.id?.trim() || v4()
      if (!value.id?.trim()) value.id = targetId
      const confirmed = await alertConfirm(language.removeConfirm + value.comment)
      if (!confirmed) return
      closeOpenRegistration()
      onRemove(targetId)
    } finally {
      deletionPending = false
    }
  }
</script>

<div
  class="w-full flex flex-col pt-2 mt-2 border-t border-t-selected first:pt-0 first:mt-0 first:border-0"
  data-risu-idx={idx}>
  <div class="flex items-center transition-colors w-full">
    <button
      class="endflex valuer border-borderc"
      aria-expanded={open}
      onclick={() => {
        open = !open
        if (open) {
          onOpen()
        } else {
          onClose()
        }
      }}>
      <span>{value.comment.length === 0 ? 'Unnamed Script' : value.comment}</span>
    </button>
    <button
      class="valuer"
      aria-label={`${language.remove}: ${value.comment || `#${idx + 1}`}`}
      disabled={deletionPending}
      onclick={removeRow}
      data-risu-regex-action="delete">
      <XIcon />
    </button>
  </div>
  {#if open}
    <div class="seperator p-2">
      <span class="text-textcolor mt-6">{language.name}</span>
      <TextInput size="sm" bind:value={value.comment} />
      <span class="text-textcolor mt-4">Modification Type</span>
      <SelectInput bind:value={value.type}>
        <OptionInput value="editinput">{language.editInput}</OptionInput>
        <OptionInput value="editoutput">{language.editOutput}</OptionInput>
        <OptionInput value="editprocess">{language.editProcess}</OptionInput>
        <OptionInput value="editdisplay">{language.editDisplay}</OptionInput>
        <OptionInput value="edittrans">{language.editTranslationDisplay}</OptionInput>
        <OptionInput value="disabled">{language.disabled}</OptionInput>
      </SelectInput>
      <span class="text-textcolor mt-6">IN:</span>
      <TextInput size="sm" bind:value={value.in} />
      <span class="text-textcolor mt-6">OUT:</span>
      <TextAreaInput highlight autocomplete="off" size="sm" bind:value={value.out} />
      {#if serverUnsupportedRegexEffectType(value.out)}
        <p class="text-warning text-sm mt-2" data-risu-server-unsupported-regex-effect="@@emo">
          {language.regexEmotionEffectUnsupportedOnServer}
        </p>
      {/if}
      {#if value.ableFlag}
        <Accordion styled name="FLAGS">
          <span class="text-textcolor mt-3">Normal Flag</span>
          <div class="grid w-full grid-cols-2 rounded-md border border-darkborderc">
            {#each flags as flag, i}
              <button
                class="w-full bg-darkbg border-darkborderc text-sm py-1"
                aria-pressed={checkFlagContain(flag[1])}
                class:border-r-1={i % 2 === 0}
                class:border-b-1={i < flags.length - 2}
                class:text-textcolor2={!checkFlagContain(flag[1])}
                class:text-textcolor={checkFlagContain(flag[1])}
                onclick={() => {
                  toggleFlag(flag[1])
                }}>
                <span>{flag[0]}</span>
              </button>
            {/each}
          </div>

          <span class="text-textcolor mt-3">Order Flag</span>
          <NumberInput
            value={getOrder()}
            onChange={(e) => {
              changeOrder(parseInt(e.currentTarget.value))
            }} />
        </Accordion>
      {/if}
      <div class="flex items-center mt-4">
        <Check
          bind:check={value.ableFlag}
          onChange={() => {
            if (!value.flag) {
              value.flag = 'g'
            }
          }} />
        <span>Custom Flag</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .valuer:hover {
    color: rgba(16, 185, 129, 1);
    cursor: pointer;
  }

  .endflex {
    display: flex;
    flex-grow: 1;
    cursor: pointer;
  }

  .seperator {
    border: none;
    outline: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    margin-bottom: 0.5rem;
  }
</style>
