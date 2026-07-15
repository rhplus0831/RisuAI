<script lang="ts">
  import { untrack } from 'svelte'
  import { language } from 'src/lang'
  import { isMaskedProviderSecret } from 'src/ts/providerSecretMask'
  import TextInput from './TextInput.svelte'

  type FormEventHandler<T extends EventTarget> = (
    event: Event & {
      currentTarget: EventTarget & T
    },
  ) => any

  interface Props {
    size?: 'sm' | 'md' | 'lg' | 'xl'
    autocomplete?: 'on' | 'off'
    placeholder?: string
    value: string
    ownerKey?: string | number
    id?: string
    padding?: boolean
    marginBottom?: boolean
    marginTop?: boolean
    oninput?: FormEventHandler<HTMLInputElement>
    onchange?: FormEventHandler<HTMLInputElement>
    onkeydown?: (
      event: KeyboardEvent & {
        currentTarget: EventTarget & HTMLInputElement
      },
    ) => any
    inputRef?: HTMLInputElement
    ariaLabel?: string
    fullwidth?: boolean
    fullh?: boolean
    className?: string
    disabled?: boolean
    list?: string
  }

  let {
    size = 'md',
    autocomplete = 'off',
    placeholder = '',
    value = $bindable(),
    ownerKey = '',
    id = undefined,
    padding = true,
    marginBottom = false,
    marginTop = false,
    oninput,
    onchange,
    onkeydown,
    inputRef = $bindable(),
    ariaLabel = undefined,
    fullwidth = false,
    fullh = false,
    className = '',
    disabled = false,
    list = undefined,
  }: Props = $props()

  let displayValue = $state(isMaskedProviderSecret(value) ? '' : value)
  let hasExistingSecret = $state(isMaskedProviderSecret(value))
  let previousExternalValue = untrack(() => value)
  let previousOwnerKey = untrack(() => ownerKey)

  $effect(() => {
    const nextExternalValue = value
    const nextOwnerKey = ownerKey
    if (nextExternalValue === previousExternalValue && nextOwnerKey === previousOwnerKey) return

    previousExternalValue = nextExternalValue
    previousOwnerKey = nextOwnerKey
    hasExistingSecret = isMaskedProviderSecret(nextExternalValue)
    displayValue = hasExistingSecret ? '' : nextExternalValue
  })

  function handleInput(event: Event & { currentTarget: EventTarget & HTMLInputElement }): void {
    const nextValue = event.currentTarget.value
    displayValue = nextValue
    hasExistingSecret = false
    previousExternalValue = nextValue
    value = nextValue
    oninput?.(event)
  }

  function clearExistingSecret(): void {
    if (disabled) return
    if (!inputRef) {
      displayValue = ''
      hasExistingSecret = false
      previousExternalValue = ''
      value = ''
      return
    }

    inputRef.value = ''
    inputRef.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }))
    inputRef.dispatchEvent(new Event('change', { bubbles: true }))
    inputRef.focus()
  }
</script>

<div class="flex flex-col items-start" class:mb-4={marginBottom} class:mt-4={marginTop} class:w-full={fullwidth}>
  <TextInput
    {size}
    {autocomplete}
    placeholder={hasExistingSecret ? language.secretInput.savedPlaceholder : placeholder}
    value={displayValue}
    {id}
    {padding}
    marginBottom={false}
    marginTop={false}
    oninput={handleInput}
    {onchange}
    {onkeydown}
    bind:inputRef
    {ariaLabel}
    {fullwidth}
    {fullh}
    {className}
    {disabled}
    hideText
    {list} />

  {#if hasExistingSecret}
    <div class="mt-1 flex items-center gap-2 text-xs text-textcolor2" data-secret-saved-state>
      <span>{language.secretInput.savedStatus}</span>
      <button
        type="button"
        class="rounded-sm underline underline-offset-2 hover:text-textcolor focus:outline-hidden focus:ring-2 focus:ring-borderc disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={language.secretInput.clearSaved}
        {disabled}
        onclick={clearExistingSecret}>
        {language.secretInput.clearSaved}
      </button>
    </div>
  {/if}
</div>
