<script>
  import { CharEmotion, ViewBoxsize } from '../../ts/stores.svelte'
  import { onMount } from 'svelte'
  import TransitionImage from './TransitionImage.svelte'
  import { getEmotion } from '../../ts/characterState'

  import { getDatabase } from 'src/ts/storage/database.svelte'
  import { language } from 'src/lang'
  import { clampResizeBoxSize, readResizePointer } from './ResizeBoxPointer'

  const KEYBOARD_RESIZE_STEP = 16

  let box = $state()
  let isResizing = false
  let initialWidth
  let initialHeight
  let initialX
  let initialY

  function handleStart(event) {
    const pointer = readResizePointer(event)
    if (!pointer) return
    isResizing = true
    initialWidth = box.clientWidth
    initialHeight = box.clientHeight
    initialX = pointer.x
    initialY = pointer.y
  }

  function handleEnd() {
    isResizing = false
  }

  function handleMove(event) {
    if (!isResizing) return
    event.preventDefault()

    const pointer = readResizePointer(event)
    if (!pointer) return
    const deltaX = initialX - pointer.x
    const deltaY = pointer.y - initialY

    const newWidth = clampResizeBoxSize(initialWidth + deltaX, window.innerWidth)
    const newHeight = clampResizeBoxSize(initialHeight + deltaY, window.innerHeight)

    ViewBoxsize.set({
      width: newWidth,
      height: newHeight,
    })
  }

  function handleKeyDown(event) {
    let widthDelta = 0
    let heightDelta = 0
    const step = KEYBOARD_RESIZE_STEP * (event.shiftKey ? 4 : 1)

    if (event.key === 'ArrowLeft') widthDelta = step
    else if (event.key === 'ArrowRight') widthDelta = -step
    else if (event.key === 'ArrowDown') heightDelta = step
    else if (event.key === 'ArrowUp') heightDelta = -step
    else return

    event.preventDefault()
    ViewBoxsize.update(({ width, height }) => ({
      width: clampResizeBoxSize(width + widthDelta, window.innerWidth),
      height: clampResizeBoxSize(height + heightDelta, window.innerHeight),
    }))
  }

  onMount(() => {
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleEnd)
    window.addEventListener('touchmove', handleMove, { passive: false })
    window.addEventListener('touchend', handleEnd)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleEnd)
      window.removeEventListener('touchmove', handleMove)
      window.removeEventListener('touchend', handleEnd)
    }
  })
</script>

<div class="box bg-darkbg/70" bind:this={box} style="width: {$ViewBoxsize.width}px; height: {$ViewBoxsize.height}px;">
  <TransitionImage classType="risu" src={getEmotion(getDatabase(), $CharEmotion, 'plain')} />
  <button
    type="button"
    aria-label={language.resizeCharacterImage}
    class="resize-handle"
    onmousedown={handleStart}
    onmouseup={handleEnd}
    ontouchstart={handleStart}
    ontouchend={handleEnd}
    onkeydown={handleKeyDown}>
  </button>
</div>

<style>
  .box {
    position: absolute;
    right: 0px;
    top: 0px;
    border-bottom: 1px solid var(--risu-theme-borderc);
    border-left: 1px solid var(--risu-theme-borderc);
    width: 12rem;
    height: 12rem;
    z-index: 5;
  }

  .resize-handle {
    position: absolute;
    width: 16px;
    height: 16px;
    border-top: 1px solid var(--risu-theme-borderc);
    border-right: 1px solid var(--risu-theme-borderc);
    cursor: sw-resize;
    padding: 0;
    background: transparent;
    bottom: 0;
    left: 0;
    z-index: 10;
  }
</style>
