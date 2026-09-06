<script lang="ts">
  import { tick } from 'svelte'
  import { language } from 'src/lang'
  import CheckInput from './CheckInput.svelte'

  let slider: HTMLDivElement = $state()
  let activePointerId: number | null = $state(null)
  let touchPointer = $state(false)
  let touchDragging = $state(false)
  let touchStartX = $state(0)
  let touchStartY = $state(0)
  let valueAtDragStart = $state(0)
  let editing = $state(false)
  let editValue: string | number | null = $state('')
  let editInput: HTMLInputElement = $state()

  const touchSlop = 8

  interface Props {
    min?: number
    max?: number
    value: number
    marginBottom?: boolean
    step?: number
    fixed?: number
    multiple?: number
    disableable?: boolean
    customText?: string | undefined
    onchange?: Function
    ariaLabel: string
    enableAriaLabel?: string
  }

  let {
    min = undefined,
    max = undefined,
    value = $bindable(),
    marginBottom = false,
    step = 1,
    fixed = 0,
    multiple = 1,
    disableable = false,
    customText = undefined,
    onchange,
    ariaLabel,
    enableAriaLabel,
  }: Props = $props()

  let isDisabledValue = $derived(value === -1000 || value === undefined)
  let sliderDisabled = $derived(disableable && isDisabledValue)
  let sliderValue = $derived(isDisabledValue ? min : value)
  let sliderPercent = $derived(((sliderValue - min) / (max - min)) * 100)
  let displayText = $derived(
    customText === undefined ? (isDisabledValue ? language.disabled : (value * multiple).toFixed(fixed)) : customText,
  )
  let canEditValue = $derived(customText === undefined && !sliderDisabled)

  function roundAndClamp(newValue: number) {
    newValue = Math.round(newValue / step) * step
    return Math.min(Math.max(newValue, min), max)
  }

  function changeValue(event: PointerEvent) {
    if (sliderDisabled) return
    const rect = slider.getBoundingClientRect()
    const x = event.clientX - rect.left
    let newValue = (x / rect.width) * (max - min) + min
    value = roundAndClamp(newValue)
  }

  function resetDragState() {
    activePointerId = null
    touchPointer = false
    touchDragging = false
  }

  function releasePointer(pointerId: number) {
    if (typeof slider.releasePointerCapture !== 'function') return
    if (typeof slider.hasPointerCapture === 'function' && !slider.hasPointerCapture(pointerId)) return
    slider.releasePointerCapture(pointerId)
  }

  function handlePointerDown(event: PointerEvent) {
    if (sliderDisabled || activePointerId !== null) return

    activePointerId = event.pointerId
    touchPointer = event.pointerType === 'touch'
    slider.setPointerCapture?.(event.pointerId)

    if (touchPointer) {
      touchStartX = event.clientX
      touchStartY = event.clientY
      valueAtDragStart = value
      touchDragging = false
      return
    }

    changeValue(event)
  }

  function handlePointerMove(event: PointerEvent) {
    if (activePointerId !== event.pointerId) return
    if (sliderDisabled) {
      resetDragState()
      releasePointer(event.pointerId)
      return
    }

    if (!touchPointer) {
      changeValue(event)
      return
    }

    const dx = event.clientX - touchStartX
    const dy = event.clientY - touchStartY
    if (!touchDragging) {
      if (Math.abs(dx) < touchSlop || Math.abs(dx) <= Math.abs(dy)) return
      touchDragging = true
    }

    const trackWidth = slider.getBoundingClientRect().width
    value = roundAndClamp(valueAtDragStart + (dx / trackWidth) * (max - min))
  }

  function handlePointerEnd(event: PointerEvent) {
    if (activePointerId !== event.pointerId) return
    resetDragState()
    releasePointer(event.pointerId)
  }

  async function beginEditing() {
    if (!canEditValue) return
    editValue = (value * multiple).toFixed(fixed)
    editing = true
    await tick()
    editInput?.focus()
    editInput?.select()
  }

  function cancelEditing() {
    editing = false
  }

  function commitEditing() {
    if (!editing) return

    const editText = editValue === null ? '' : String(editValue)
    const parsedValue = Number(editText)
    if (editText.trim() !== '' && Number.isFinite(parsedValue) && multiple !== 0) {
      value = roundAndClamp(parsedValue / multiple)
    }
    editing = false
  }

  function handleEditKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitEditing()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelEditing()
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (sliderDisabled) return
    let newValue = value

    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        newValue -= step
        break
      case 'ArrowRight':
      case 'ArrowUp':
        newValue += step
        break
      case 'Home':
        newValue = min
        break
      case 'End':
        newValue = max
        break
      default:
        return
    }

    event.preventDefault()
    value = Math.min(Math.max(newValue, min), max)
  }
</script>

<div class="w-full flex" class:mb-4={marginBottom}>
  {#if disableable}
    <div
      class="relative h-8 border-darkborderc border rounded-full cursor-pointer rounded-r-none border-r-0 flex justify-center items-center pl-2">
      <CheckInput
        check={value !== -1000 && value !== undefined}
        margin={false}
        name={enableAriaLabel ?? `${language.enable}: ${ariaLabel}`}
        hiddenName={true}
        onChange={(c) => {
          onchange?.()
          if (c) {
            value = min
          } else {
            value = -1000
          }
        }}></CheckInput>
    </div>
  {/if}
  <div class="relative h-8 w-full">
    <div
      role="slider"
      tabindex={sliderDisabled ? undefined : 0}
      aria-disabled={sliderDisabled ? 'true' : undefined}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={sliderValue}
      aria-valuetext={displayText}
      aria-label={ariaLabel}
      class="relative w-full h-8 border-darkborderc border rounded-full"
      class:rounded-l-none={disableable}
      class:cursor-pointer={!sliderDisabled}
      class:cursor-not-allowed={sliderDisabled}
      style:background={`linear-gradient(to right, var(--risu-theme-darkbutton) 0%, var(--risu-theme-darkbutton) ${sliderPercent}%, var(--risu-theme-darkbg) ${sliderPercent}%, var(--risu-theme-darkbg) 100%)`}
      style:touch-action="pan-y"
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerEnd}
      onpointercancel={handlePointerEnd}
      onlostpointercapture={resetDragState}
      onkeydown={handleKeydown}
      bind:this={slider}>
      {#if !sliderDisabled}
        <span
          aria-hidden="true"
          class="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-darkborderc bg-textcolor shadow-sm"
          style:left={`clamp(0.625rem, ${sliderPercent}%, calc(100% - 0.625rem))`}></span>
      {/if}
    </div>

    {#if editing && canEditValue}
      <input
        bind:this={editInput}
        bind:value={editValue}
        type="number"
        inputmode="decimal"
        step="any"
        aria-label={`${ariaLabel}: ${language.edit} ${language.value}`}
        class="absolute left-1/2 top-1/2 z-20 h-7 w-24 -translate-x-1/2 -translate-y-1/2 rounded-md border border-darkborderc bg-darkbg px-2 text-center text-sm text-textcolor shadow-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500"
        onkeydown={handleEditKeydown}
        onblur={commitEditing} />
    {:else if canEditValue}
      <button
        type="button"
        aria-label={`${ariaLabel}: ${language.edit} ${language.value}`}
        class="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-md border border-darkborderc bg-darkbg px-2 py-0.5 text-sm text-textcolor shadow-sm hover:bg-darkbutton focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500"
        onclick={beginEditing}>
        {displayText}
      </button>
    {:else}
      <span
        class="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-md bg-darkbg px-2 py-0.5 text-sm text-textcolor">
        {displayText}
      </span>
    {/if}
  </div>
</div>
