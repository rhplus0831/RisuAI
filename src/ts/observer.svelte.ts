import { globalFetch } from './globalApi.svelte'
import { language } from '../lang'

let bgmElement: HTMLAudioElement | null = null
let observedCodeBlocks = new WeakSet<HTMLElement>()
let observedControlNodes = new WeakSet<HTMLElement>()
let domObserver: MutationObserver | null = null
let observedBody: HTMLElement | null = null
let bodyRetryTimer: ReturnType<typeof setTimeout> | null = null
let pendingBgmRetry: { node: HTMLElement; control: string } | null = null
let bgmRetryListenersAttached = false
let bgmControlNode: HTMLElement | null = null

function clearPendingBgmRetry() {
  pendingBgmRetry = null
  if (!bgmRetryListenersAttached || typeof document === 'undefined') return

  document.removeEventListener('pointerdown', retryPendingBgm, true)
  document.removeEventListener('keydown', retryPendingBgm, true)
  bgmRetryListenersAttached = false
}

function retryPendingBgm() {
  const pending = pendingBgmRetry
  clearPendingBgmRetry()
  if (
    !pending ||
    bgmElement ||
    !pending.node.isConnected ||
    pending.node.getAttribute('risu-ctrl') !== pending.control
  ) {
    return
  }

  observedControlNodes.delete(pending.node)
  nodeObserve(pending.node)
}

function scheduleBgmRetry(node: HTMLElement, control: string) {
  pendingBgmRetry = { node, control }
  if (bgmRetryListenersAttached || typeof document === 'undefined') return

  // Invoke play directly from the next user-activation event so browser
  // autoplay policies can accept the retry.
  document.addEventListener('pointerdown', retryPendingBgm, true)
  document.addEventListener('keydown', retryPendingBgm, true)
  bgmRetryListenersAttached = true
}

function stopCurrentBgm() {
  clearPendingBgmRetry()
  const current = bgmElement
  if (!current) {
    return
  }

  bgmElement = null
  bgmControlNode = null
  current.pause()
  current.remove()
}

export function resetBgmObserverForChatSwitch() {
  stopCurrentBgm()
  observedControlNodes = new WeakSet()
}

function nodeObserve(node: HTMLElement) {
  const hlLang = node.getAttribute('x-hl-lang')
  const ctrlName = node.getAttribute('risu-ctrl')

  if (hlLang && !observedCodeBlocks.has(node)) {
    observedCodeBlocks.add(node)
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault()

      const prevContextMenu = document.getElementById('code-contextmenu')
      if (prevContextMenu) {
        prevContextMenu.remove()
      }

      const menu = document.createElement('div')
      menu.id = 'code-contextmenu'
      menu.setAttribute('role', 'menu')
      menu.setAttribute('class', 'fixed z-50 min-w-[160px] py-2 bg-gray-800 rounded-lg border border-gray-700')

      const copyOption = document.createElement('button')
      copyOption.type = 'button'
      copyOption.textContent = language.copy
      copyOption.setAttribute('role', 'menuitem')
      copyOption.setAttribute(
        'class',
        'block w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 cursor-pointer',
      )
      copyOption.addEventListener('click', () => {
        navigator.clipboard.writeText(node.textContent ?? '')
        menu.remove()
      })

      const downloadOption = document.createElement('button')
      downloadOption.type = 'button'
      downloadOption.textContent = language.download
      downloadOption.setAttribute('role', 'menuitem')
      downloadOption.setAttribute(
        'class',
        'block w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 cursor-pointer',
      )
      downloadOption.addEventListener('click', () => {
        const a = document.createElement('a')
        const url = URL.createObjectURL(new Blob([node.textContent ?? ''], { type: 'text/plain' }))
        try {
          a.href = url
          a.download = 'code.' + (node.getAttribute('x-hl-lang') ?? hlLang)
          a.click()
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 0)
        }
        menu.remove()
      })

      menu.appendChild(copyOption)
      menu.appendChild(downloadOption)

      menu.style.left = e.clientX + 'px'
      menu.style.top = e.clientY + 'px'

      document.body.appendChild(menu)
      copyOption.focus()

      document.addEventListener(
        'click',
        () => {
          menu?.remove()
        },
        { once: true },
      )
    })
  }

  if (ctrlName) {
    const split = ctrlName.split('___')

    switch (split[0]) {
      case 'bgm': {
        if (observedControlNodes.has(node)) {
          break
        }
        observedControlNodes.add(node)
        const volume = split[1] === 'auto' ? 0.5 : parseFloat(split[1])
        if (!bgmElement) {
          clearPendingBgmRetry()
          const audio = new Audio(split[2])
          bgmElement = audio
          bgmControlNode = node
          audio.volume = volume
          audio.addEventListener('ended', () => {
            audio.remove()
            if (bgmElement === audio) {
              bgmElement = null
              bgmControlNode = null
            }
          })
          const playback = audio.play()
          if (playback && typeof playback.catch === 'function') {
            void playback.catch(() => {
              if (bgmElement !== audio) return
              bgmElement = null
              bgmControlNode = null
              audio.pause()
              audio.remove()
              observedControlNodes.delete(node)
              if (node.isConnected && node.getAttribute('risu-ctrl') === ctrlName) {
                scheduleBgmRetry(node, ctrlName)
              }
            })
          }
        }
        break
      }
    }
  }
}

const OBSERVED_NODE_SELECTOR = '[x-hl-lang], [risu-ctrl]'

function observeNodeAndDescendants(node: HTMLElement) {
  nodeObserve(node)
  node.querySelectorAll<HTMLElement>(OBSERVED_NODE_SELECTOR).forEach(nodeObserve)
}

function handleDomMutations(mutations: MutationRecord[]) {
  for (const mutation of mutations) {
    if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
      nodeObserve(mutation.target)
      continue
    }

    mutation.removedNodes.forEach((node) => {
      const activeControl = bgmControlNode
      if (activeControl && (node === activeControl || node.contains(activeControl))) {
        observedControlNodes.delete(activeControl)
        stopCurrentBgm()
      }
    })

    mutation.addedNodes.forEach((node) => {
      if (node instanceof HTMLElement) {
        observeNodeAndDescendants(node)
      }
    })
  }
}

function scheduleBodyRetry() {
  if (bodyRetryTimer !== null) {
    return
  }

  bodyRetryTimer = setTimeout(() => {
    bodyRetryTimer = null
    startObserveDom()
  }, 50)
}

export function startObserveDom(): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return stopObserveDom
  }

  const body = document.body
  if (!body) {
    scheduleBodyRetry()
    return stopObserveDom
  }

  observeNodeAndDescendants(body)

  if (domObserver && observedBody === body) {
    return stopObserveDom
  }

  domObserver?.disconnect()
  observedBody = body
  domObserver = new MutationObserver(handleDomMutations)
  domObserver.observe(body, {
    attributes: true,
    attributeFilter: ['x-hl-lang', 'risu-ctrl'],
    childList: true,
    subtree: true,
  })
  return stopObserveDom
}

/** App/remount lifecycle cleanup for the optional DOM observer runtime. */
export function stopObserveDom(): void {
  domObserver?.disconnect()
  domObserver = null
  observedBody = null
  if (bodyRetryTimer !== null) {
    clearTimeout(bodyRetryTimer)
    bodyRetryTimer = null
  }
  stopCurrentBgm()
  observedControlNodes = new WeakSet()
}

export function _resetDomObserverForTesting() {
  stopObserveDom()
  observedCodeBlocks = new WeakSet()
}

export function _getBgmElementForTesting() {
  return bgmElement
}

let claudeObserverRunning = false
let lastClaudeObserverLoad = 0
let lastClaudeRequestTimes = 0
let lastClaudeObserverPayload: any = null
let lastClaudeObserverHeaders: any = null
let lastClaudeObserverURL: any = null

export function registerClaudeObserver(arg: { url: string; body: any; headers: any }) {
  lastClaudeRequestTimes = 0
  lastClaudeObserverLoad = Date.now()
  // Only the top-level `max_tokens` scalar is overridden, so a shallow spread
  // replaces the full deep clone of the (potentially large) request body. The
  // observer only reads this payload as a fetch body and never mutates nested
  // fields, so sharing the nested references with `arg.body` is safe.
  lastClaudeObserverPayload = { ...arg.body, max_tokens: 10 }
  lastClaudeObserverHeaders = arg.headers
  lastClaudeObserverURL = arg.url
  claudeObserver()
}

function claudeObserver() {
  if (claudeObserverRunning) {
    return
  }
  claudeObserverRunning = true

  const fetchIt = async (tries = 0) => {
    const res = await globalFetch(lastClaudeObserverURL, {
      body: lastClaudeObserverPayload,
      headers: lastClaudeObserverHeaders,
      method: 'POST',
    })
    if (res.status >= 400) {
      if (tries < 3) {
        fetchIt(tries + 1)
      }
    }
  }

  const func = () => {
    //request every 4 minutes and 30 seconds
    if (lastClaudeObserverLoad > Date.now() - 1000 * 60 * 4.5) {
      return
    }

    if (lastClaudeRequestTimes > 4) {
      return
    }
    fetchIt()
    lastClaudeObserverLoad = Date.now()
    lastClaudeRequestTimes += 1
  }

  setInterval(func, 20000)
}
