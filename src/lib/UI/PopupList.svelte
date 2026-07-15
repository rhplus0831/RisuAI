<script lang="ts">
  import { popupStore, SizeStore } from 'src/ts/stores.svelte'
  import { sleep } from 'src/ts/util'
  import { onDestroy, onMount, tick } from 'svelte'
  import { language } from 'src/lang'

  let menuElement: HTMLDivElement | undefined = $state()

  let styleString = $derived.by(() => {
    let styleString = ''
    const windowWidth = $SizeStore.w
    const windowHeight = $SizeStore.h
    const mouseX = popupStore.mouseX
    const mouseY = popupStore.mouseY

    if (mouseX < windowWidth / 2) {
      styleString += `left: ${mouseX}px;`
    } else {
      styleString += `right: ${windowWidth - mouseX}px;`
    }
    if (mouseY < windowHeight / 2) {
      styleString += `top: ${mouseY}px;`
    } else {
      styleString += `bottom: ${windowHeight - mouseY}px;`
    }
    return styleString
  })

  const close = (restoreFocus = false) => {
    const trigger = popupStore.trigger
    popupStore.children = null
    popupStore.openId = 0
    popupStore.trigger = null
    if (restoreFocus) {
      queueMicrotask(() => trigger?.focus())
    }
  }

  const menuItems = () =>
    menuElement
      ? Array.from(
          menuElement.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], [role="menuitem"]:not([aria-disabled="true"]), [tabindex]:not([tabindex="-1"])',
          ),
        )
      : []

  function prepareMenu(): void {
    for (const item of menuItems()) {
      if ((item.tagName === 'BUTTON' || item.tagName === 'A') && !item.hasAttribute('role')) {
        item.setAttribute('role', 'menuitem')
      }
    }
  }

  function handleMenuKeydown(event: KeyboardEvent): void {
    const items = menuItems()
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    if (event.key === 'Tab') {
      close(false)
      return
    }
    if (items.length === 0 || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return

    event.preventDefault()
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Home') {
      items[0].focus()
    } else if (event.key === 'End') {
      items[items.length - 1].focus()
    } else if (event.key === 'ArrowDown') {
      items[(currentIndex + 1 + items.length) % items.length].focus()
    } else {
      items[(currentIndex - 1 + items.length) % items.length].focus()
    }
  }

  onMount(async () => {
    await sleep(0)
    document.addEventListener('click', handleDocumentClick)
  })

  onDestroy(() => {
    document.removeEventListener('click', handleDocumentClick)
  })

  function handleDocumentClick(event: MouseEvent): void {
    if (!popupStore.children) return
    close(Boolean(menuElement?.contains(event.target as Node)))
  }

  $effect(() => {
    const children = popupStore.children
    if (!children) return
    void tick().then(() => {
      if (popupStore.children !== children || !menuElement) return
      prepareMenu()
      ;(menuItems()[0] ?? menuElement).focus()
    })
  })
</script>

{#if popupStore.children}
  <div
    bind:this={menuElement}
    id="risu-popup-menu"
    role="menu"
    aria-label={language.moreActions}
    tabindex="-1"
    onkeydown={handleMenuKeydown}
    class="bg-darkbg border-darkborderc border rounded-md p-4 gap-2 flex flex-col fixed z-50 items-start max-w-[calc(100vw-1rem)] max-h-[calc(100vh-1rem)] overflow-auto"
    style={styleString}>
    {@render popupStore.children()}
  </div>
{/if}
