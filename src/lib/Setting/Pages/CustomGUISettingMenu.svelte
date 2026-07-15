<script lang="ts">
  import { flushSync } from 'svelte'
  import {
    createServerBackedSettingDraft,
    flushPendingServerBackedSettingsPatch,
  } from 'src/ts/server/settingsBridge.svelte'
  import { CustomGUISettingMenuStore } from 'src/ts/stores.svelte'
  import { language } from 'src/lang'

  interface CustomTree {
    name: string // dom name, like div, span, etc. for component, we use 'component'
    type: string // type, used for identifying in editor
    class: string[] // classes, used for styling in tailwind
    children: CustomTree[] // children, used for nesting
  }

  let tree: CustomTree[] = $state([]) //children of the main tree
  const guiHTMLDraft = createServerBackedSettingDraft<string>('guiHTML', '')
  let mainTree: HTMLDivElement = $state()
  let menuOpen: boolean = $state(false)
  let subMenu = $state(0)
  let selectedContatiner = $state('root')
  let previousGuiHTML = ''
  let suppressTreePersistence = false

  const builtContainerTrees: CustomTree[] = [
    {
      type: 'leftToRightContainer',
      name: 'div',
      class: ['flex', 'flex-row', 'flex-1'],
      children: [],
    },
    {
      type: 'topToBottomContainer',
      name: 'div',
      class: ['flex', 'flex-col', 'flex-1'],
      children: [],
    },
    {
      type: 'centeredleftToRightContainer',
      name: 'div',
      class: ['flex', 'flex-row', 'flex-1', 'items-center', 'justify-center'],
      children: [],
    },
    {
      type: 'centeredTopToBottomContainer',
      name: 'div',
      class: ['flex', 'flex-col', 'flex-1', 'items-center', 'justify-center'],
      children: [],
    },
  ]

  const builtComponentTrees: CustomTree[] = [
    {
      type: 'fullWidthChat',
      name: 'component',
      class: ['flex', 'flex-col', 'flex-1'],
      children: [],
    },
    {
      type: 'fixedWidthChat',
      name: 'component',
      class: ['flex', 'flex-col', 'w-96'],
      children: [],
    },
    {
      type: 'sideBarWithCharacter',
      name: 'component',
      class: ['flex', 'flex-col', 'w-96'],
      children: [],
    },
    {
      type: 'sideBarWithoutCharacter',
      name: 'component',
      class: ['flex', 'flex-col', 'w-96'],
      children: [],
    },
  ]

  function renderTree(dom: HTMLElement, currentTree: CustomTree, treeChain: string = '') {
    let element = document.createElement(currentTree.name)
    element.classList.add(...currentTree.class)
    currentTree.children.forEach((child, i) => {
      renderTree(element, child, treeChain + '.' + i)
    })

    if (currentTree.type === 'custom') {
      dom.appendChild(element)
    } else {
      const textElement = document.createElement('p')
      textElement.innerText = currentTree.type
      if (treeChain === selectedContatiner) {
        element.classList.add('bg-blue-200/50', 'border-2', 'border-blue-400', 'relative', 'p-4', 'z-20')
        textElement.classList.add('absolute', 'top-0', 'left-0', 'bg-blue-200', 'p-1', 'text-black')
      } else {
        element.classList.add('bg-gray-200/50', 'border-2', 'border-gray-400', 'relative', 'p-4', 'z-20')
        textElement.classList.add('absolute', 'top-0', 'left-0', 'bg-white', 'p-1', 'text-black')
      }
      element.appendChild(textElement)
      element.setAttribute('x-tree', treeChain)
      dom.appendChild(element)

      element.addEventListener('mouseup', (e) => {
        console.log(treeChain, e.button)
        e.preventDefault()
        e.stopPropagation()
        switch (e.button) {
          case 0:
            selectedContatiner = treeChain
            renderMainTree(tree)
            break
          case 2:
            if (removeTreeChain(tree, treeChain)) {
              selectedContatiner = rebaseTreeChainAfterRemoval(selectedContatiner, treeChain)
              if (selectedContatiner !== 'root' && !resolveTreeChain(tree, selectedContatiner)) {
                selectedContatiner = 'root'
              }
              persistTree()
            }
            renderMainTree(tree)
            break
        }
      })

      element.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        e.stopPropagation()
      })
    }
  }

  function parseTreeChain(treeChain: string): number[] | null {
    if (!treeChain || treeChain === 'root') return null
    const indexes = treeChain.split('.').map(Number)
    return indexes.every((index) => Number.isInteger(index) && index >= 0) ? indexes : null
  }

  function resolveTreeChain(rootTree: CustomTree[], treeChain: string): CustomTree | null {
    const indexes = parseTreeChain(treeChain)
    if (!indexes) return null

    let currentTree = rootTree
    let node: CustomTree | undefined
    for (const index of indexes) {
      node = currentTree[index]
      if (!node) return null
      currentTree = node.children
    }
    return node ?? null
  }

  function rebaseTreeChainAfterRemoval(selected: string, removed: string): string {
    if (selected === 'root') return selected
    const selectedIndexes = parseTreeChain(selected)
    const removedIndexes = parseTreeChain(removed)
    if (!selectedIndexes || !removedIndexes) return 'root'

    const removedDepth = removedIndexes.length - 1
    if (selectedIndexes.length <= removedDepth) return selected
    for (let depth = 0; depth < removedDepth; depth += 1) {
      if (selectedIndexes[depth] !== removedIndexes[depth]) return selected
    }

    if (selectedIndexes[removedDepth] === removedIndexes[removedDepth]) {
      const parent = removedIndexes.slice(0, -1)
      return parent.length > 0 ? parent.join('.') : 'root'
    }
    if (selectedIndexes[removedDepth] > removedIndexes[removedDepth]) {
      selectedIndexes[removedDepth] -= 1
      return selectedIndexes.join('.')
    }
    return selected
  }

  function removeTreeChain(rootTree: CustomTree[], treeChain: string): boolean {
    const indexes = parseTreeChain(treeChain)
    if (!indexes) return false

    let currentTree = rootTree
    for (let depth = 0; depth < indexes.length; depth += 1) {
      const index = indexes[depth]
      const node = currentTree[index]
      if (!node) return false
      if (depth === indexes.length - 1) {
        currentTree.splice(index, 1)
        return true
      }
      currentTree = node.children
    }
    return false
  }

  function renderMainTree(tree: CustomTree[]) {
    if (!mainTree) return
    mainTree.innerHTML = ''
    tree.forEach((child, i) => {
      renderTree(mainTree, child, i.toString())
    })
  }

  function HTMLtoTree(html: string) {
    let parser = new DOMParser()
    let doc = parser.parseFromString(html, 'text/html')
    let body = doc.body
    let tree: CustomTree[] = []
    let children = body.children
    for (let i = 0; i < children.length; i++) {
      let child = children[i]
      let treeChild: CustomTree = {
        name: child.tagName.toLowerCase(),
        type: child.getAttribute('data-risu-type') || child.tagName.toLowerCase(),
        class: child.className.split(' ').filter(Boolean),
        children: [],
      }
      if (child.children.length > 0) {
        treeChild.children = HTMLtoTree(child.innerHTML)
      }
      tree.push(treeChild)
    }
    return tree
  }

  function addContainerToTree(container: CustomTree, treeChain: string): boolean {
    if (treeChain === 'root') {
      tree.push(container)
      return true
    }

    const target = resolveTreeChain(tree, treeChain)
    if (!target) {
      selectedContatiner = 'root'
      return false
    }
    target.children.push(container)
    return true
  }

  function treeToHTML(tree: CustomTree[], indent: number = 0) {
    let html = ''
    const noClosingTag = ['img', 'input', 'br', 'hr']
    const ind = '    '.repeat(indent)
    tree.forEach((child) => {
      const attributes: string[] = []
      if (child.class.length > 0) attributes.push(`class="${escapeAttribute(child.class.join(' '))}"`)
      if (child.type && child.type !== child.name) attributes.push(`data-risu-type="${escapeAttribute(child.type)}"`)
      html += `${ind}<${child.name}${attributes.length > 0 ? ` ${attributes.join(' ')}` : ''}>\n`

      if (noClosingTag.includes(child.name)) {
        return
      }

      if (child.children.length > 0) {
        html += treeToHTML(child.children, indent + 1)
      }
      html += `${ind}</${child.name}>\n`
    })
    return html
  }

  function escapeAttribute(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  }

  function persistTree() {
    if (suppressTreePersistence) return
    const html = treeToHTML(tree)
    previousGuiHTML = html
    guiHTMLDraft.value = html
  }

  function closeEditor() {
    persistTree()
    flushSync()
    flushPendingServerBackedSettingsPatch()
    CustomGUISettingMenuStore.set(false)
  }

  function handleEditorKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    closeEditor()
  }

  $effect(() => {
    const html = guiHTMLDraft.value ?? ''
    if (html === previousGuiHTML) return

    suppressTreePersistence = true
    tree = HTMLtoTree(html)
    selectedContatiner = 'root'
    previousGuiHTML = html
    renderMainTree(tree)
    queueMicrotask(() => {
      suppressTreePersistence = false
    })
  })

  $effect(() => {
    if (!mainTree) return
    renderMainTree(tree)
  })

  interface Props {
    oncontextmenu?: (
      event: MouseEvent & {
        currentTarget: EventTarget & HTMLDivElement
      },
    ) => any
  }

  let { oncontextmenu }: Props = $props()
</script>

<svelte:window onkeydown={handleEditorKeydown} />

<button
  type="button"
  aria-keyshortcuts="Escape"
  title={`${language.goback} (Esc)`}
  data-risu-custom-gui-back
  class="absolute top-0 left-0 z-30 p-2 border bg-white text-black rounded-sm"
  onclick={closeEditor}>{language.goback}</button>

<!-- svelte-ignore a11y_role_has_required_aria_props -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="w-full h-full relative flex p-4 border"
  class:border-blue-500={selectedContatiner === 'root'}
  role="option"
  tabindex="0"
  onclick={() => {
    selectedContatiner = 'root'
    renderMainTree(tree)
  }}
  oncontextmenu={(e) => {
    e.preventDefault()
    oncontextmenu?.(e)
  }}
  bind:this={mainTree}>
</div>
{#if menuOpen}
  <div class="w-138 max-w-full h-full bg-white text-black border-l border-l-black p-4 flex flex-col gap-2 z-20">
    <div class="flex">
      <button
        class="mr-2 p-2 border border-black rounded-sm"
        class:text-gray-500={subMenu !== 0}
        onclick={() => {
          subMenu = 0
        }}>Component</button>
      <button
        class="mr-2 p-2 border border-black rounded-sm"
        class:text-gray-500={subMenu !== 1}
        onclick={() => {
          subMenu = 1
        }}>Container</button>
      <button
        class="mr-2 p-2 border border-black rounded-sm"
        class:text-gray-500={subMenu !== 2}
        onclick={() => {
          subMenu = 2
        }}>Help</button>
    </div>
    <div class="border-b border-b-gray-200"></div>
    {#if subMenu === 0}
      {#each builtComponentTrees as component, i}
        <button
          class="p-2 border border-black rounded-sm"
          onclick={() => {
            if (!addContainerToTree(safeStructuredClone(component), selectedContatiner)) {
              renderMainTree(tree)
              return
            }
            persistTree()
            renderMainTree(tree)
          }}>{component.type}</button>
      {/each}
    {:else if subMenu === 1}
      {#each builtContainerTrees as container, i}
        <button
          class="p-2 border border-black rounded-sm"
          onclick={() => {
            if (!addContainerToTree(safeStructuredClone(container), selectedContatiner)) {
              renderMainTree(tree)
              return
            }
            persistTree()
            renderMainTree(tree)
          }}>{container.type}</button>
      {/each}
    {:else if subMenu === 2}
      <p>Left click to select, Right click to delete</p>
      <p>Press a component/container in the menu to add it to the selected container</p>
    {/if}
  </div>
{:else}
  <button
    class="absolute top-0 right-0 z-20 p-2 border bg-white rounded-sm"
    onclick={() => {
      menuOpen = !menuOpen
    }}>Menu</button>
{/if}
