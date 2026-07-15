<script lang="ts">
  import { MenuIcon } from '@lucide/svelte'
  import { popupStore } from 'src/ts/stores.svelte'
  import { sleep } from 'src/ts/util'
  import { language } from 'src/lang'

  const {
    children,
  }: {
    children: import('svelte').Snippet
  } = $props()

  let buttonId = Math.random()
  let buttonElement: HTMLButtonElement
</script>

<button
  bind:this={buttonElement}
  type="button"
  aria-label={language.moreActions}
  aria-haspopup="menu"
  aria-controls="risu-popup-menu"
  aria-expanded={popupStore.openId === buttonId && Boolean(popupStore.children)}
  onclick={async (e: MouseEvent) => {
    const trigger = e.currentTarget as HTMLButtonElement
    const keyboardClick = e.detail === 0
    const rect = trigger.getBoundingClientRect()
    await sleep(0)
    if (popupStore.openId === buttonId) {
      popupStore.children = null
      popupStore.openId = 0
      popupStore.trigger = null
      return
    }
    popupStore.mouseX = keyboardClick ? rect.left : e.clientX
    popupStore.mouseY = keyboardClick ? rect.bottom : e.clientY
    popupStore.children = children
    popupStore.openId = buttonId
    popupStore.trigger = buttonElement
  }}
  class="hover:text-blue-500 transition-colors button-icon-menu">
  <MenuIcon size={20} />
</button>
