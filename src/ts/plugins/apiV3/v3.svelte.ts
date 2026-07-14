import {
  allowedDbKeys,
  customProviderStore,
  getV2PluginAPIs,
  handlePluginInstallViaPlugin,
  pluginV2,
  type PluginV2ProviderArgument,
  type PluginV2ProviderOptions,
  type RisuPlugin,
} from '../plugins.svelte'
import { SandboxHost } from './factory'
import { getDatabase } from 'src/ts/storage/database.svelte'
import { currentPluginStateSnapshot, dispatchUpdatePlugin } from 'src/ts/pluginCommands'
import { canUseServerCommands, patchServerBackedSettings } from 'src/ts/server/commands'
import { captureSettingsPatchProjectionEpochs } from 'src/ts/server/resourceState.svelte'
import { currentCharacterRowSnapshot, prepareCompatibleCharacterUpdateScoped } from 'src/ts/characterCommands'
import {
  appendCurrentChatUserMessageForSend,
  prepareCompatibleChatUpdateScoped,
  runOptimisticCommandSequence,
} from 'src/ts/chatCommands'
import {
  SafeLocalPluginStorage,
  assertDeviceLocalPluginStorageEnabled,
  isDeviceLocalPluginStorageEnabled,
  tagWhitelist,
} from '../pluginSafeClass'
import DOMPurify from 'dompurify'
import {
  additionalChatMenu,
  additionalFloatingActionButtons,
  additionalHamburgerMenu,
  additionalSettingsMenu,
  bodyIntercepterStore,
  selectedCharID,
  type MenuDef,
} from 'src/ts/stores.svelte'
import { v4 } from 'uuid'
import { sleep } from 'src/ts/util'
import { alertConfirm, alertError, alertNormal } from 'src/ts/alert'
import { language } from 'src/lang'
import { checkCharOrder, getFetchLogs } from 'src/ts/globalApi.svelte'
import { changeColorScheme, updateColorScheme, updateTextThemeAndCSS, type ColorScheme } from 'src/ts/gui/colorscheme'
import { get } from 'svelte/store'
import { registerMCPModule, unregisterMCPModule } from 'src/ts/process/mcp/pluginmcp'
import { getLLMCache, searchLLMCache } from 'src/ts/translator/translator'
import { hasher } from 'src/ts/parser/parser.svelte'
import localforage from 'localforage'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer, type LLMModel } from 'src/ts/model/types'
import { sendChat as processSendChat, doingChat } from 'src/ts/process/index.svelte'
import { getModelInfo } from 'src/ts/model/modellist'
import type { ModelModeExtended } from 'src/ts/process/request/shared'
import { requestChatDataMain } from 'src/ts/process/request/request'
import {
  registerTTSPreprocessor,
  unregisterTTSPreprocessor,
  registerTTSPostprocessor,
  unregisterTTSPostprocessor,
  type BeforeTTSContext,
  type BeforeTTSResult,
  type AfterTTSContext,
  type AfterTTSResult,
  type TTSHookFn,
} from 'src/ts/process/ttsHooks'
import { withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'
import { assertNoUnsupportedCharacterChanges, assertNoUnsupportedChatChanges } from '../unsupportedServerWriteGuard'
import { applyAttemptedFieldRollback } from 'src/ts/server/staleStateGuards'

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function dispatchPluginApiSettingsPatch(patch: Record<string, unknown>, previous: Record<string, unknown>): void {
  if (!canUseServerCommands()) return
  const attempted = cloneJsonValue(patch)
  const rollbackPrevious = cloneJsonValue(previous)
  void patchServerBackedSettings({
    patch: attempted,
    acknowledgeOptimistic: true,
    optimisticProjectionEpochs: captureSettingsPatchProjectionEpochs(attempted),
    rollback: () => {
      withTrustedResourceWrite(() => {
        const rolledBack = applyAttemptedFieldRollback({
          target: getDatabase() as unknown as Record<string, unknown>,
          previous: rollbackPrevious,
          attempted,
        })
        if (rolledBack.some((key) => key === 'colorScheme' || key === 'colorSchemeName')) {
          updateColorScheme()
        }
        if (rolledBack.some((key) => key === 'textTheme' || key === 'customTextTheme')) {
          updateTextThemeAndCSS()
        }
      })
    },
  })
}

/*
    V3 API for RisuAI Plugins

    Before adding new APIs here, please check the limitations

    - APIs must be a functions
        - If you want nested objects, first add as a plain function, `_getPluginStorage` for example
            And add it too _getAliases function ({'pluginStorage':{'getItem': '_getPluginStorage', ... }})
            This will make pluginStorage.getItem() work in plugins
        - If you need constants, use _getPropertiesForInitialization to set them up
            For example apiVersion and apiVersionCompatibleWith are set this way,
            Accessable in plugins as risuai.apiVersion
    - APIs must return, or accept as parameters, only the following types:
        - Serializable data (string, number, boolean, null, array, object)
        - Class instances marked with __classType = 'REMOTE_REQUIRED'
        - Callback functions (only as parameters)
        - Note that Class or Callbacks inside arrays or objects are not supported
*/

const pluginChannel = new Map<string, Function>()

class PluginLifecycleCleanup {
  #cleanups = new Set<() => void>()

  public track(cleanup: () => void): () => void {
    let active = true
    const wrapped = () => {
      if (!active) return
      active = false
      this.#cleanups.delete(wrapped)
      cleanup()
    }
    this.#cleanups.add(wrapped)
    return wrapped
  }

  public cleanupAll() {
    for (const cleanup of Array.from(this.#cleanups)) {
      cleanup()
    }
  }
}

class SafeElement {
  #element: HTMLElement
  #lifecycle?: PluginLifecycleCleanup
  __classType = 'REMOTE_REQUIRED' as const

  constructor(element: HTMLElement, lifecycle?: PluginLifecycleCleanup) {
    if (element.getAttribute('freezed')) {
      throw new Error('This element cannot be accessed by SafeELement')
    }
    this.#element = element
    this.#lifecycle = lifecycle
  }

  public appendChild(child: SafeElement) {
    this.#element.appendChild(child.#element)
  }

  public removeChild(child: SafeElement) {
    this.#element.removeChild(child.#element)
  }

  public replaceChild(newChild: SafeElement, oldChild: SafeElement) {
    this.#element.replaceChild(newChild.#element, oldChild.#element)
  }

  public replaceWith(newElement: SafeElement) {
    this.#element.replaceWith(newElement.#element)
  }

  public cloneNode(deep: boolean = false): SafeElement {
    const cloned = this.#element.cloneNode(deep)
    return new SafeElement(cloned as HTMLElement, this.#lifecycle)
  }

  public prepend(child: SafeElement) {
    this.#element.prepend(child.#element)
  }

  public remove() {
    this.#element.remove()
  }

  public innerText(): string {
    return this.#element.innerText
  }

  public textContent(): string | null {
    return this.#element.textContent
  }

  public setTextContent(value: string) {
    this.#element.textContent = value
  }

  public setInnerText(value: string) {
    this.#element.innerText = value
  }

  public setAttribute(name: string, value: string) {
    if (!name.startsWith('x-')) {
      throw new Error(
        "Can only set attributes starting with 'x-' for security reasons. for other attributes, use dedicated methods.",
      )
    }
    this.#element.setAttribute(name, value)
  }
  public getAttribute(name: string): string | null {
    if (!name.startsWith('x-')) {
      throw new Error(
        "Can only get attributes starting with 'x-' for security reasons. for other attributes, use dedicated methods.",
      )
    }
    return this.#element.getAttribute(name)
  }
  public setStyle(property: string, value: string) {
    ;(this.#element.style as any)[property] = value
  }
  public getStyle(property: string): string {
    return (this.#element.style as any)[property]
  }
  public getStyleAttribute(): string {
    return this.#element.getAttribute('style') || ''
  }
  public setStyleAttribute(value: string) {
    this.#element.setAttribute('style', value)
  }
  public addClass(className: string) {
    this.#element.classList.add(className)
  }
  public removeClass(className: string) {
    this.#element.classList.remove(className)
  }
  public setClassName(className: string) {
    this.#element.className = className
  }
  public getClassName() {
    return this.#element.className
  }
  public hasClass(className: string): boolean {
    //We don't need to check the className here since we're just checking
    return this.#element.classList.contains(className)
  }
  public focus() {
    this.#element.focus()
  }
  public getChildren(): SafeClassArray<SafeElement> {
    const children: SafeElement[] = []
    this.#element.childNodes.forEach((node) => {
      if (node instanceof HTMLElement) {
        children.push(new SafeElement(node, this.#lifecycle))
      }
    })
    return new SafeClassArray<SafeElement>(children)
  }
  public getParent(): SafeElement | null {
    if (this.#element.parentElement) {
      return new SafeElement(this.#element.parentElement, this.#lifecycle)
    }
    return null
  }
  public getInnerHTML(): string {
    return this.#element.innerHTML
  }
  public getOuterHTML(): string {
    return this.#element.outerHTML
  }
  public clientHeight(): number {
    return this.#element.clientHeight
  }
  public clientWidth(): number {
    return this.#element.clientWidth
  }
  public clientTop(): number {
    return this.#element.clientTop
  }
  public clientLeft(): number {
    return this.#element.clientLeft
  }
  public nodeName(): string {
    return this.#element.nodeName
  }
  public nodeType(): number {
    return this.#element.nodeType
  }
  public querySelectorAll(selector: string): SafeClassArray<SafeElement> {
    const nodeList = this.#element.querySelectorAll(selector)
    const elements: SafeElement[] = []
    nodeList.forEach((node) => {
      if (node instanceof HTMLElement) {
        elements.push(new SafeElement(node, this.#lifecycle))
      }
    })
    return new SafeClassArray<SafeElement>(elements)
  }
  public querySelector(selector: string): SafeElement | null {
    const element = this.#element.querySelector(selector)
    if (element instanceof HTMLElement) {
      return new SafeElement(element, this.#lifecycle)
    }
    return null
  }
  public getElementById(id: string): SafeElement | null {
    const element = this.querySelector('#' + id)
    return element
  }
  public getElementsByClassName(className: string): SafeClassArray<SafeElement> {
    return this.querySelectorAll('.' + className)
  }
  public getClientRects(): DOMRectList {
    return this.#element.getClientRects()
  }
  public getBoundingClientRect(): DOMRect {
    return this.#element.getBoundingClientRect()
  }
  public setInnerHTML(value: string) {
    const san = DOMPurify.sanitize(value)
    this.#element.innerHTML = san
  }
  public setOuterHTML(value: string) {
    const san = DOMPurify.sanitize(value)
    this.#element.outerHTML = san
  }
  public scrollIntoView(options?: boolean | ScrollIntoViewOptions) {
    this.#element.scrollIntoView(options)
  }
  #eventIdMap = new Map<
    string,
    {
      type: string
      listener: EventListenerOrEventListenerObject
      options: EventListenerOptions
      cleanup: () => void
    }
  >()

  public async addEventListener(
    type: string,
    listener: (event: any) => void,
    options?: boolean | AddEventListenerOptions,
  ): Promise<string> {
    const realOptions = typeof options === 'boolean' ? { capture: options } : options || {}

    //allowed with unlimited
    const allowedDocumentEventListeners = [
      'click',
      'dblclick',
      'contextmenu',
      'mousedown',
      'mouseup',
      'mousemove',
      'mouseover',
      'mouseleave',
      'pointercancel',
      'pointerdown',
      'pointerenter',
      'pointerleave',
      'pointermove',
      'pointerout',
      'pointerover',
      'pointerup',
      'scroll',
      'scrollend',
    ]

    //allowed, but it has fingerprinting issues,
    //so it will be delayed random ms.
    const allowedDelayedEventListeners = ['keydown', 'keyup', 'keypress']

    const id = v4()

    const trimEvent = (event: MouseEvent | KeyboardEvent | Event) => {
      if (event instanceof MouseEvent) {
        return {
          type: event.type,
          clientX: event.clientX,
          clientY: event.clientY,
          button: event.button,
          buttons: event.buttons,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
        }
      } else if (event instanceof KeyboardEvent) {
        return {
          type: event.type,
          key: event.key,
          code: event.code,
          repeat: event.repeat,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
        }
      } else {
        return {
          type: event.type,
        }
      }
    }

    if (allowedDocumentEventListeners.includes(type)) {
      const modifiedListener = (event: any) => {
        listener(trimEvent(event))
      }
      document.addEventListener(type, modifiedListener, realOptions)
      const cleanup = this.#lifecycle?.track(() => {
        document.removeEventListener(type, modifiedListener, realOptions)
        this.#eventIdMap.delete(id)
      })
      this.#eventIdMap.set(id, {
        type,
        listener: modifiedListener,
        options: realOptions,
        cleanup: cleanup ?? (() => {}),
      })
      return id
    } else if (allowedDelayedEventListeners.includes(type)) {
      const modifiedListener = (event: any) => {
        let delay = 0
        try {
          delay = (crypto.getRandomValues(new Uint32Array(1))[0] / 100) % 100 //0-99 ms
        } catch (error) {}
        setTimeout(() => {
          listener(trimEvent(event))
        }, delay)
      }
      document.addEventListener(type, modifiedListener, realOptions)
      const cleanup = this.#lifecycle?.track(() => {
        document.removeEventListener(type, modifiedListener, realOptions)
        this.#eventIdMap.delete(id)
      })
      this.#eventIdMap.set(id, {
        type,
        listener: modifiedListener,
        options: realOptions,
        cleanup: cleanup ?? (() => {}),
      })
      return id
    } else {
      throw new Error(`Event listener of type '${type}' is not allowed for security reasons.`)
    }
  }

  public removeEventListener(type: string, id: string, options?: boolean | EventListenerOptions) {
    const record = this.#eventIdMap.get(id)
    if (record) {
      const realOptions = typeof options === 'boolean' ? { capture: options } : options || {}
      document.removeEventListener(type, record.listener, realOptions)
      this.#eventIdMap.delete(id)
      record.cleanup()
    }
  }

  public matches(selector: string): boolean {
    return this.#element.matches(selector)
  }
}

class SafeDocument extends SafeElement {
  __classType = 'REMOTE_REQUIRED' as const
  #lifecycle?: PluginLifecycleCleanup

  constructor(document: Document, lifecycle?: PluginLifecycleCleanup) {
    super(document.documentElement, lifecycle)
    this.#lifecycle = lifecycle
  }
  createElement(tagName: string): SafeElement {
    if (!tagWhitelist.includes(tagName.toLowerCase())) {
      console.warn(`Creation of <${tagName}> elements is restricted. Creating a <div> instead.`)
      tagName = 'div'
    }
    if (tagName.toLowerCase() === 'a') {
      console.warn(
        `<a> can be created but href attribute cannot be set directly for security reasons. Use .createAnchorElement(href: string) to create safe anchor elements.`,
      )
    }
    const element = document.createElement(tagName)
    return new SafeElement(element, this.#lifecycle)
  }
  createAnchorElement(href: string): SafeElement {
    const anchor = document.createElement('a')
    try {
      const url = new URL(href)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Invalid protocol')
      }
      anchor.setAttribute('href', url.toString())
    } catch (error) {
      console.warn(`Invalid URL provided for anchor element: ${href}. Setting href to '#' instead.`)
      anchor.setAttribute('href', '#')
    }
    return new SafeElement(anchor, this.#lifecycle)
  }
}

type SafeMutationRecordObject = {
  type: string
  target: SafeElement
  addedNodes: SafeElement[]
}

class SafeClassArray<T> {
  #items: T[]
  __classType = 'REMOTE_REQUIRED' as const
  constructor(items: T[] = []) {
    this.#items = items
  }
  at(index: number): T {
    return this.#items.at(index)
  }
  length(): number {
    return this.#items.length
  }
  push(item: T) {
    this.#items.push(item)
  }
}

class SafeMutationRecord {
  __classType = 'REMOTE_REQUIRED' as const
  #type: string
  #target: SafeElement
  #addedNodes: SafeClassArray<SafeElement>
  constructor(type: string, target: SafeElement, addedNodes: SafeElement[]) {
    this.#type = type
    this.#target = target
    this.#addedNodes = new SafeClassArray<SafeElement>(addedNodes)
  }
  getType(): string {
    return this.#type
  }
  getTarget(): SafeElement {
    return this.#target
  }
  getAddedNodes(): SafeClassArray<SafeElement> {
    return this.#addedNodes
  }
}

type SafeMutationCallback = (mutations: SafeClassArray<SafeMutationRecord>) => void

class SafeMutationObserver {
  #observer: MutationObserver
  #cleanup: () => void
  __classType = 'REMOTE_REQUIRED' as const
  constructor(callback: SafeMutationCallback, lifecycle?: PluginLifecycleCleanup) {
    this.#observer = new MutationObserver((mutations) => {
      const safeMutations: SafeMutationRecordObject[] = mutations.map((mutation) => {
        const elementMapHelper = (nodeList: NodeList): SafeElement[] => {
          const elements: SafeElement[] = []
          nodeList.forEach((node) => {
            if (node instanceof HTMLElement) {
              elements.push(new SafeElement(node, lifecycle))
            }
          })
          return elements
        }

        return {
          type: mutation.type,
          target: new SafeElement(mutation.target as HTMLElement, lifecycle),
          addedNodes: elementMapHelper(mutation.addedNodes),
          removedNodes: elementMapHelper(mutation.removedNodes),
        }
      })

      const safeClassed = new SafeClassArray<SafeMutationRecord>([])
      for (const record of safeMutations) {
        safeClassed.push(new SafeMutationRecord(record.type, record.target, record.addedNodes))
      }
      callback(safeClassed)
    })
    this.#cleanup = lifecycle?.track(() => this.#observer.disconnect()) ?? (() => {})
  }

  observe(element: SafeElement, options: MutationObserverInit) {
    const identifier = v4()
    element.setAttribute('x-identifier', identifier)
    const rawElement = document.querySelector(`[x-identifier="${identifier}"]`) as HTMLElement
    if (rawElement) {
      this.#observer.observe(rawElement, options)
      element.setAttribute('x-identifier', '')
    }
  }

  disconnect() {
    this.#cleanup()
  }
}

type V3PluginInstance = {
  name: string
  host?: SandboxHost
  lifecycle: PluginLifecycleCleanup
  generation: number
  active: boolean
}

type PluginUnloadCallback = {
  generation: number
  callback: Function
}

const v3PluginInstances: V3PluginInstance[] = []
let v3GenerationCounter = 0
let activeV3Generation = 0

function ensureV3Generation() {
  if (activeV3Generation === 0) {
    activeV3Generation = ++v3GenerationCounter
  }
  return activeV3Generation
}

function beginV3Generation() {
  activeV3Generation = ++v3GenerationCounter
  for (const instance of v3PluginInstances) {
    instance.active = false
  }
  syncV3ProviderRegistrations()
  return activeV3Generation
}

function isV3InstanceCurrent(instance: V3PluginInstance) {
  return instance.active && instance.generation === activeV3Generation
}

function assertV3InstanceCurrent(instance: V3PluginInstance) {
  if (!isV3InstanceCurrent(instance)) {
    throw new Error(`[RisuAI Plugin: ${instance.name}] Plugin instance is no longer active.`)
  }
}

const pluginUnloadCallbacks: Map<string, PluginUnloadCallback[]> = new Map()

const addPluginUnloadCallback = (pluginName: string, callback: Function, generation = activeV3Generation) => {
  if (!pluginUnloadCallbacks.has(pluginName)) {
    pluginUnloadCallbacks.set(pluginName, [])
  }
  pluginUnloadCallbacks.get(pluginName)?.push({ generation, callback })
}

type V3OwnedMenuDef = MenuDef & {
  __v3OwnerToken: string
}

const ownMenuDef = (menuDef: MenuDef): V3OwnedMenuDef => {
  return {
    ...menuDef,
    __v3OwnerToken: v4(),
  }
}

const makeMenuUnloadCallback = (menuDef: V3OwnedMenuDef, menuStore: MenuDef[]) => {
  return () => {
    const index = menuStore.findIndex(
      (item) => item.id === menuDef.id && (item as V3OwnedMenuDef).__v3OwnerToken === menuDef.__v3OwnerToken,
    )
    if (index !== -1) {
      menuStore.splice(index, 1)
    }
  }
}

const takePluginUnloadCallbacks = (pluginName: string, generation: number): Function[] => {
  const records = pluginUnloadCallbacks.get(pluginName)
  if (!records) return []

  const callbacks: Function[] = []
  const remaining: PluginUnloadCallback[] = []
  for (const record of records) {
    if (record.generation === generation) {
      callbacks.push(record.callback)
    } else {
      remaining.push(record)
    }
  }

  if (remaining.length === 0) {
    pluginUnloadCallbacks.delete(pluginName)
  } else {
    pluginUnloadCallbacks.set(pluginName, remaining)
  }
  return callbacks
}

const runPluginUnloadCallbacks = async (pluginName: string, callbacks: Function[]) => {
  let promises: Promise<void>[] = []
  for (const callback of callbacks) {
    try {
      const result = callback()
      if (result instanceof Promise) {
        promises.push(
          result.catch((error) => {
            console.error(`Error running unload callback for plugin ${pluginName}:`, error)
          }),
        )
      }
    } catch (error) {
      console.error(`Error running unload callback for plugin ${pluginName}:`, error)
    }
  }

  await Promise.any([
    Promise.all(promises),
    sleep(1000), //timeout after 1 second
  ])
}

const unloadV3PluginInstance = async (instance: V3PluginInstance) => {
  instance.active = false
  const index = v3PluginInstances.indexOf(instance)
  if (index !== -1) {
    v3PluginInstances.splice(index, 1)
  }

  const callbacks = takePluginUnloadCallbacks(instance.name, instance.generation)
  try {
    await runPluginUnloadCallbacks(instance.name, callbacks)
  } finally {
    try {
      instance.lifecycle.cleanupAll()
      instance.host?.terminate()
    } catch (error) {
      console.error(`Error terminating plugin ${instance.name}:`, error)
    }
  }
}

const unloadV3Plugin = async (pluginName: string) => {
  const instance = v3PluginInstances.find((p) => p.name === pluginName)
  if (!instance) {
    await runPluginUnloadCallbacks(pluginName, takePluginUnloadCallbacks(pluginName, activeV3Generation))
    return
  }
  await unloadV3PluginInstance(instance)
}

const permissionGivenPlugins: Set<string> = new Set()
const permissionDeniedPlugins: Set<string> = new Set()
const permissionForage = localforage.createInstance({
  name: 'plugin_permissions',
  storeName: 'plugin_permissions',
})

type PluginV3ProviderOptions = PluginV2ProviderOptions & {
  model?: LLMModel
}

export const customV3ProviderMetaStore: LLMModel[] = []

type V3ProviderRegistration = {
  pluginName: string
  generation: number
  name: string
  handler: (
    arg: PluginV2ProviderArgument,
    abortSignal?: AbortSignal,
  ) => Promise<{ success: boolean; content: string | ReadableStream<string> }>
  options: PluginV2ProviderOptions
  modelData: LLMModel
}

const v3ProviderRegistrations: V3ProviderRegistration[] = []
const v3SyncedProviderRegistrations = new Map<string, V3ProviderRegistration>()
const registeredV3ProviderUnloadCallbacks = new Set<string>()

function syncCustomProviderStoreFromMap() {
  customProviderStore.set(Array.from(pluginV2.providers.keys()))
}

function getActiveV3ProviderRegistrations() {
  const active = new Map<string, V3ProviderRegistration>()
  for (const registration of v3ProviderRegistrations) {
    if (registration.generation !== activeV3Generation) {
      continue
    }
    active.set(registration.name, registration)
  }
  return active
}

function syncV3ProviderRegistrations() {
  const active = getActiveV3ProviderRegistrations()
  const knownNames = new Set([...v3SyncedProviderRegistrations.keys(), ...active.keys()])

  for (const name of knownNames) {
    const previous = v3SyncedProviderRegistrations.get(name)
    const next = active.get(name)
    if (next) {
      pluginV2.providers.set(name, next.handler)
      pluginV2.providerOptions.set(name, next.options)
      v3SyncedProviderRegistrations.set(name, next)
    } else {
      if (previous && pluginV2.providers.get(name) === previous.handler) {
        pluginV2.providers.delete(name)
        pluginV2.providerOptions.delete(name)
      }
      v3SyncedProviderRegistrations.delete(name)
    }
  }

  customV3ProviderMetaStore.splice(
    0,
    customV3ProviderMetaStore.length,
    ...Array.from(active.values()).map((registration) => registration.modelData),
  )
  syncCustomProviderStoreFromMap()
}

function unregisterV3ProvidersForPlugin(pluginName: string, generation?: number) {
  for (let i = v3ProviderRegistrations.length - 1; i >= 0; i--) {
    const registration = v3ProviderRegistrations[i]
    if (
      registration.pluginName === pluginName &&
      (generation === undefined || registration.generation === generation)
    ) {
      v3ProviderRegistrations.splice(i, 1)
    }
  }
  if (generation === undefined) {
    for (const key of Array.from(registeredV3ProviderUnloadCallbacks)) {
      if (key.endsWith(`:${pluginName}`)) {
        registeredV3ProviderUnloadCallbacks.delete(key)
      }
    }
  } else {
    registeredV3ProviderUnloadCallbacks.delete(`${generation}:${pluginName}`)
  }
  syncV3ProviderRegistrations()
}

function registerV3Provider(registration: V3ProviderRegistration) {
  if (registration.generation !== activeV3Generation) {
    return
  }

  for (let i = v3ProviderRegistrations.length - 1; i >= 0; i--) {
    const existing = v3ProviderRegistrations[i]
    if (
      existing.pluginName === registration.pluginName &&
      existing.generation === registration.generation &&
      existing.name === registration.name
    ) {
      v3ProviderRegistrations.splice(i, 1)
    }
  }

  v3ProviderRegistrations.push(registration)
  const unloadKey = `${registration.generation}:${registration.pluginName}`
  if (!registeredV3ProviderUnloadCallbacks.has(unloadKey)) {
    registeredV3ProviderUnloadCallbacks.add(unloadKey)
    addPluginUnloadCallback(
      registration.pluginName,
      () => unregisterV3ProvidersForPlugin(registration.pluginName, registration.generation),
      registration.generation,
    )
  }
  syncV3ProviderRegistrations()
}

const getPluginPermission = async (
  pluginName: string,
  permissionDesc: 'fetchLogs' | 'db' | 'mainDom' | 'replacer' | 'provider' | 'sendChat',
  reconfirm: boolean | 'periodically' = false,
) => {
  if (permissionGivenPlugins.has(pluginName)) {
    return true
  }
  if (permissionDeniedPlugins.has(pluginName)) {
    return false
  }

  let pluginHash = ''

  let requiresReconfirm = false

  if (reconfirm === 'periodically') {
    const lastGrantTime: number = await permissionForage.getItem(pluginName + '_' + permissionDesc + '_lastGrantTime')
    const now = Date.now()
    if (!lastGrantTime || now - lastGrantTime > 3 * 24 * 60 * 60 * 1000) {
      //3 days
      requiresReconfirm = true
    }
  } else if (reconfirm === true) {
    requiresReconfirm = true
  }

  pluginHash =
    (await hasher(new TextEncoder().encode(getDatabase().plugins.find((p) => p.name === pluginName)?.script))) +
    `_${permissionDesc}`

  if (!requiresReconfirm && (await permissionForage.getItem(pluginHash))) {
    permissionGivenPlugins.add(pluginName)
    return true
  }

  let alertTitle =
    permissionDesc === 'fetchLogs'
      ? language.fetchLogConsent.replace('{}', pluginName)
      : permissionDesc === 'db'
        ? language.getFullDatabaseConsent.replace('{}', pluginName)
        : permissionDesc === 'mainDom'
          ? language.mainDomAccessConsent.replace('{}', pluginName)
          : permissionDesc === 'replacer'
            ? language.replacerPermissionConsent.replace('{}', pluginName)
            : permissionDesc === 'provider'
              ? language.providerPermissionConsent.replace('{}', pluginName)
              : permissionDesc === 'sendChat'
                ? language.sendChatConsent.replace('{}', pluginName)
                : `Error`
  if (alertTitle === 'Error') {
    return false
  }
  const conf = await alertConfirm(alertTitle)
  if (conf && pluginHash) {
    permissionGivenPlugins.add(pluginName)
    await permissionForage.setItem(pluginHash, true)
    if (reconfirm === 'periodically') {
      await permissionForage.setItem(pluginName + '_' + permissionDesc + '_lastGrantTime', Date.now())
    }
    return true
  }
  permissionDeniedPlugins.add(pluginName)
  return false
}

const urlBlacklist = ['risuai.xyz', 'risuai.net', 'sionyw.com']

const authorizationHeaders = ['x-api-key', 'authorization', 'proxy-authorization']

const guardV3Api = (api: Record<string, unknown>, instance: V3PluginInstance): Record<string, unknown> => {
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function') {
        return value
      }
      return (...args: unknown[]) => {
        assertV3InstanceCurrent(instance)
        return value.apply(target, args)
      }
    },
  })
}

const makeRisuaiAPIV3 = (
  iframe: HTMLIFrameElement,
  plugin: RisuPlugin,
  lifecycle: PluginLifecycleCleanup,
  instance: V3PluginInstance,
) => {
  const oldApis = getV2PluginAPIs()
  const api = {
    //Old APIs from v2.1
    risuFetch: (url, options) => {
      console.error(
        `[DEPRECATION WARNING] risuFetch is deprecated and will be removed in future versions. Please use nativeFetch instead.`,
      )
      for (const blocked of urlBlacklist) {
        if (url.toLowerCase().includes(blocked)) {
          throw new Error(`Requests to ${blocked} are blocked for security reasons.`)
        }
      }

      //scan headers
      const headers = options?.headers || {}
      for (const headerName in headers) {
        if (authorizationHeaders.includes(headerName.toLowerCase())) {
          console.warn(
            `Request contains potentially sensitive header '${headerName}'. handling of such headers may be changed to only work with nativeFetch.`,
          )
        }
      }
      return oldApis.risuFetch(url, options)
    },
    nativeFetch: (url, options) => {
      for (const blocked of urlBlacklist) {
        if (url.toLowerCase().includes(blocked)) {
          throw new Error(`Requests to ${blocked} are blocked for security reasons.`)
        }
      }

      //scan headers
      const headers = options?.headers || {}
      for (const headerName in headers) {
        if (authorizationHeaders.includes(headerName.toLowerCase())) {
          console.warn(
            `Request contains potentially sensitive header '${headerName}'. handling of such headers may be changed to use server-side approch with write-only api access in the future for better security.`,
          )
        }
      }
      return oldApis.nativeFetch(url, options)
    },
    getChar: oldApis.getChar,
    setChar: oldApis.setChar,
    addProvider: (
      name: string,
      func: (
        arg: PluginV2ProviderArgument,
        abortSignal?: AbortSignal,
      ) => Promise<{ success: boolean; content: string }>,
      options?: PluginV3ProviderOptions,
    ) => {
      console.warn(
        `[WARN] addProvider is a powerful API that can potentially be unsafe if used incorrectly. addProvider's functionality might be limited or changed in future updates to ensure security. please use other APIs if possible.`,
      )
      const handler = async (arg: PluginV2ProviderArgument, abortSignal?: AbortSignal) => {
        assertV3InstanceCurrent(instance)
        await getPluginPermission(plugin.name, 'provider', 'periodically')
        assertV3InstanceCurrent(instance)
        // Force v3 mode for plugin provider isolation.
        arg.mode = 'v3'
        return await func(arg, abortSignal)
      }

      const modelData: LLMModel = {
        id: `pluginmodel:::${name}`,
        name: options?.model?.name ?? name,
        shortName: options?.model?.shortName ?? name,
        fullName: options?.model?.fullName ?? name,
        internalID: options?.model?.internalID ?? `pluginmodel:::${name}`,
        provider: LLMProvider.AsIs,
        format: LLMFormat.Plugin,
        flags: options?.model?.flags ?? [LLMFlags.hasFullSystemPrompt],
        parameters: options?.model?.parameters ?? [
          'temperature',
          'top_p',
          'frequency_penalty',
          'presence_penalty',
          'repetition_penalty',
          'min_p',
          'top_a',
          'top_k',
          'thinking_tokens',
        ],
        tokenizer: options?.model?.tokenizer ?? LLMTokenizer.Unknown,
      }
      registerV3Provider({
        pluginName: plugin.name,
        generation: instance.generation,
        name,
        handler,
        options: options ?? {},
        modelData,
      })
    },
    addTTSPreprocessor: async (func: TTSHookFn<BeforeTTSContext, BeforeTTSResult>) => {
      registerTTSPreprocessor(func)
      addPluginUnloadCallback(plugin.name, () => unregisterTTSPreprocessor(func))
    },
    addTTSPostprocessor: async (func: TTSHookFn<AfterTTSContext, AfterTTSResult>) => {
      registerTTSPostprocessor(func)
      addPluginUnloadCallback(plugin.name, () => unregisterTTSPostprocessor(func))
    },
    addRisuScriptHandler: oldApis.addRisuScriptHandler,
    removeRisuScriptHandler: oldApis.removeRisuScriptHandler,
    addRisuReplacer: async (name: string, func: Function) => {
      //permission check for replacer
      const conf = await getPluginPermission(plugin.name, 'replacer', 'periodically')
      assertV3InstanceCurrent(instance)
      if (!conf) {
        return
      }
      oldApis.addRisuReplacer(name, func as any)
    },
    removeRisuReplacer: oldApis.removeRisuReplacer,
    setDatabaseLite: oldApis.setDatabaseLite,
    setDatabase: oldApis.setDatabase,
    loadPlugins: oldApis.loadPlugins,
    readImage: oldApis.readImage,
    saveAsset: oldApis.saveAsset,
    //Same functionality, but new implementation
    getDatabase: async (includeOnly: string[] | 'all' = 'all') => {
      const conf = await getPluginPermission(plugin.name, 'db', 'periodically')
      if (!conf) {
        return null
      }
      const db = getDatabase()
      let liteDB = {}
      for (const key of allowedDbKeys) {
        if (includeOnly !== 'all' && !includeOnly.includes(key)) {
          continue
        }
        ;(liteDB as any)[key] = $state.snapshot((db as any)[key])
      }
      return liteDB
    },

    installPlugin: handlePluginInstallViaPlugin,

    // --- Color Scheme APIs ---
    changeColorScheme: (name: string) => {
      const previous = {
        colorScheme: cloneJsonValue(getDatabase().colorScheme),
        colorSchemeName: getDatabase().colorSchemeName,
      }
      changeColorScheme(name)
      dispatchPluginApiSettingsPatch(
        {
          colorScheme: cloneJsonValue(getDatabase().colorScheme),
          colorSchemeName: getDatabase().colorSchemeName,
        },
        previous,
      )
    },
    setColorScheme: (scheme: ColorScheme) => {
      const requiredKeys = [
        'bgcolor',
        'darkbg',
        'borderc',
        'selected',
        'draculared',
        'textcolor',
        'textcolor2',
        'darkBorderc',
        'darkbutton',
        'type',
      ] as const
      for (const key of requiredKeys) {
        if (typeof (scheme as any)[key] !== 'string') {
          throw new Error(`Invalid color scheme: missing or invalid '${key}'`)
        }
      }
      if (scheme.type !== 'light' && scheme.type !== 'dark') {
        throw new Error('Invalid color scheme type: must be "light" or "dark"')
      }
      const previous = {
        colorScheme: cloneJsonValue(getDatabase().colorScheme),
        colorSchemeName: getDatabase().colorSchemeName,
      }
      withTrustedResourceWrite(() => {
        getDatabase().colorSchemeName = 'custom'
        getDatabase().colorScheme = scheme
      })
      updateColorScheme()
      dispatchPluginApiSettingsPatch(
        {
          colorScheme: cloneJsonValue(getDatabase().colorScheme),
          colorSchemeName: getDatabase().colorSchemeName,
        },
        previous,
      )
    },
    getColorScheme: () => {
      const db = getDatabase()
      return {
        name: db.colorSchemeName,
        scheme: $state.snapshot(db.colorScheme),
      }
    },

    // --- Text Theme APIs ---
    changeTextTheme: (name: string) => {
      if (!['standard', 'highcontrast'].includes(name)) {
        throw new Error(`Invalid text theme: ${name}`)
      }
      const previous = {
        textTheme: getDatabase().textTheme,
      }
      withTrustedResourceWrite(() => {
        getDatabase().textTheme = name
      })
      updateTextThemeAndCSS()
      dispatchPluginApiSettingsPatch({ textTheme: getDatabase().textTheme }, previous)
    },
    setCustomTextTheme: (theme: {
      FontColorStandard: string
      FontColorBold: string
      FontColorItalic: string
      FontColorItalicBold: string
      FontColorQuote1: string
      FontColorQuote2: string
    }) => {
      const requiredKeys = [
        'FontColorStandard',
        'FontColorBold',
        'FontColorItalic',
        'FontColorItalicBold',
        'FontColorQuote1',
        'FontColorQuote2',
      ] as const
      for (const key of requiredKeys) {
        if (typeof (theme as any)[key] !== 'string') {
          throw new Error(`Invalid text theme: missing or invalid '${key}'`)
        }
      }
      const previous = {
        textTheme: getDatabase().textTheme,
        customTextTheme: cloneJsonValue(getDatabase().customTextTheme),
      }
      withTrustedResourceWrite(() => {
        getDatabase().textTheme = 'custom'
        getDatabase().customTextTheme = theme
      })
      updateTextThemeAndCSS()
      dispatchPluginApiSettingsPatch(
        {
          textTheme: getDatabase().textTheme,
          customTextTheme: cloneJsonValue(getDatabase().customTextTheme),
        },
        previous,
      )
    },
    getTextTheme: () => {
      const db = getDatabase()
      return {
        name: db.textTheme,
        customTheme: $state.snapshot(db.customTextTheme),
      }
    },

    //Deprecated APIs from v2.1
    //Use getArgument / setArgument instead if possible
    getArg: oldApis.getArg,
    setArg: oldApis.setArg,

    //New APIs for v3
    getArgument: async (key: string) => {
      const db = getDatabase()
      for (const p of db.plugins) {
        if (p.name === plugin.name) {
          return p.realArg[key]
        }
      }
    },
    setArgument: async (key: string, value: string) => {
      const previous = currentPluginStateSnapshot()
      let matched = false
      withTrustedResourceWrite(() => {
        const db = getDatabase()
        for (const p of db.plugins) {
          if (p.name === plugin.name) {
            p.realArg[key] = value
            matched = true
          }
        }
      })
      if (matched) {
        const p = getDatabase().plugins.find((candidate) => candidate.name === plugin.name)
        if (p) {
          dispatchUpdatePlugin(p.name, { realArg: p.realArg }, previous)
        }
      }
    },
    getCharacterFromIndex: (index: number) => {
      const db = getDatabase()
      const charIds = Object.keys(db.characters)
      const charId = charIds[index]
      if (charId) {
        return $state.snapshot(db.characters[charId])
      }
      return null
    },
    setCharacterToIndex: (index: number, char: any) => {
      const db = getDatabase()
      const charIds = Object.keys(db.characters)
      const charId = charIds[index]
      if (charId) {
        if (!canUseServerCommands()) {
          withTrustedResourceWrite(() => {
            getDatabase().characters[charId] = char
          })
          return
        }

        const previousCharacter = getDatabase().characters[charId]
        assertNoUnsupportedCharacterChanges(previousCharacter, char, 'setCharacterToIndex')
        const previous = currentCharacterRowSnapshot(index)
        const previousCharacterSnapshot = $state.snapshot(previousCharacter)
        // Route through the sequencer so this call shares one advancing revision
        // baseline with other makeRisuaiAPIV3 command factories.
        const { factories, optimisticCharacter, rollback } = prepareCompatibleCharacterUpdateScoped(
          previousCharacterSnapshot,
          char,
          previous,
        )
        if (!optimisticCharacter || factories.length === 0) return
        withTrustedResourceWrite(() => {
          getDatabase().characters[charId] = optimisticCharacter
        })
        runOptimisticCommandSequence(factories, rollback)
      }
    },
    getChatFromIndex: (characterIndex: number, chatIndex: number) => {
      const db = getDatabase()
      const charIds = Object.keys(db.characters)
      const charId = charIds[characterIndex]
      if (charId) {
        const chats = db.characters[charId].chats
        if (chats && chats[chatIndex]) {
          return $state.snapshot(chats[chatIndex])
        }
      }
      return null
    },
    setChatToIndex: (characterIndex: number, chatIndex: number, chat: any) => {
      const db = getDatabase()
      const charIds = Object.keys(db.characters)
      const charId = charIds[characterIndex]
      if (charId) {
        const chats = db.characters[charId].chats
        if (chats && chats[chatIndex]) {
          const previousChat = getDatabase().characters[charId].chats[chatIndex]
          if (canUseServerCommands()) {
            assertNoUnsupportedChatChanges(previousChat, chat, 'setChatToIndex')
          }
          const previousChatSnapshot = $state.snapshot(previousChat)
          const previous = {
            selectedCharID: get(selectedCharID),
            characterId: getDatabase().characters[charId]?.chaId,
            chatId: previousChatSnapshot.id,
            chat: previousChatSnapshot,
          }
          withTrustedResourceWrite(() => {
            getDatabase().characters[charId].chats[chatIndex] = chat
          })
          // Route through the sequencer so this call shares one advancing revision
          // baseline with other makeRisuaiAPIV3 command factories.
          const { factories, rollback } = prepareCompatibleChatUpdateScoped(previousChatSnapshot, chat, previous)
          runOptimisticCommandSequence(factories, rollback)
        }
      }
    },
    getCurrentCharacterIndex: () => {
      return get(selectedCharID)
    },
    getCurrentChatIndex: () => {
      const db = getDatabase()
      const charId = get(selectedCharID)
      return db.characters[charId].chatPage
    },
    //New names for character APIs, to match API naming conventions
    getCharacter: oldApis.getChar,
    setCharacter: oldApis.setChar,

    showContainer: (type: 'fullscreen' = 'fullscreen') => {
      iframe.style.display = 'block'

      switch (type) {
        case 'fullscreen': {
          //move iframe to body if not already there
          if (iframe.parentElement !== document.body) {
            document.body.appendChild(iframe)
          }

          //Make iframe cover whole screen
          iframe.style.position = 'fixed'
          iframe.style.top = '0'
          iframe.style.left = '0'
          iframe.style.width = '100%'
          iframe.style.height = '100%'
          iframe.style.border = 'none'
          iframe.style.zIndex = '1000'
          break
        }
        default: {
          return
        }
      }
    },
    hideContainer: () => {
      iframe.style.display = 'none'
    },
    getRootDocument: async () => {
      const conf = await getPluginPermission(plugin.name, 'mainDom')
      assertV3InstanceCurrent(instance)
      if (!conf) {
        return null
      }
      return new SafeDocument(document, lifecycle)
    },
    registerSetting: (
      name: string,
      callback: any,
      icon: string = '',
      iconType: 'html' | 'img' | 'none' = 'none',
      id?: string,
    ) => {
      if (iconType !== 'html' && iconType !== 'img' && iconType !== 'none') {
        throw new Error("iconType must be 'html', 'img' or 'none'")
      }
      if (typeof name !== 'string' || name.trim() === '') {
        throw new Error('name must be a non-empty string')
      }
      const menuId = id || v4()
      const menuDef = ownMenuDef({
        id: menuId,
        name,
        icon,
        iconType,
        callback,
      })
      const existingIndex = additionalSettingsMenu.findIndex((item) => item.id === menuId)
      if (existingIndex !== -1) {
        additionalSettingsMenu[existingIndex] = menuDef
        addPluginUnloadCallback(
          plugin.name,
          makeMenuUnloadCallback(menuDef, additionalSettingsMenu),
          instance.generation,
        )
        return { id: menuId }
      }
      additionalSettingsMenu.push(menuDef)
      addPluginUnloadCallback(plugin.name, makeMenuUnloadCallback(menuDef, additionalSettingsMenu), instance.generation)
      return { id: menuId }
    },
    registerBodyIntercepter: async (callback: (body: any, type: string) => any) => {
      if ((await getPluginPermission(plugin.name, 'replacer')) === false) {
        return null
      }
      assertV3InstanceCurrent(instance)

      const id = v4()
      bodyIntercepterStore.push({
        id,
        callback,
      })
      addPluginUnloadCallback(plugin.name, () => {
        const index = bodyIntercepterStore.findIndex((item) => item.id === id)
        if (index !== -1) {
          bodyIntercepterStore.splice(index, 1)
        }
      })
      return { id: id }
    },

    unregisterBodyIntercepter: (id: string) => {
      const index = bodyIntercepterStore.findIndex((item) => item.id === id)
      if (index !== -1) {
        bodyIntercepterStore.splice(index, 1)
      }
    },

    registerButton: (
      arg: {
        name: string
        icon: string
        iconType: 'html' | 'img' | 'none'
        location?: 'action' | 'chat' | 'hamburger'
        id?: string
      },
      callback: () => void,
    ) => {
      let { name, icon, iconType, location, id: providedId } = arg
      location = location || 'action'
      if (iconType !== 'html' && iconType !== 'img' && iconType !== 'none') {
        throw new Error("iconType must be 'html', 'img' or 'none'")
      }
      if (typeof name !== 'string' || name.trim() === '') {
        throw new Error('name must be a non-empty string')
      }
      if (typeof icon !== 'string') {
        throw new Error('icon must be a string')
      }
      const id = providedId || v4()
      const menuDef = ownMenuDef({
        name,
        icon,
        iconType,
        callback,
        id,
      })

      const buttonStores = [additionalFloatingActionButtons, additionalHamburgerMenu, additionalChatMenu]
      for (const store of buttonStores) {
        const existingIndex = store.findIndex((item) => item.id === id)
        if (existingIndex !== -1) {
          store[existingIndex] = menuDef
          addPluginUnloadCallback(plugin.name, makeMenuUnloadCallback(menuDef, store), instance.generation)
          return { id }
        }
      }

      switch (location) {
        case 'action': {
          additionalFloatingActionButtons.push(menuDef)
          addPluginUnloadCallback(
            plugin.name,
            makeMenuUnloadCallback(menuDef, additionalFloatingActionButtons),
            instance.generation,
          )
          break
        }
        case 'hamburger': {
          additionalHamburgerMenu.push(menuDef)
          addPluginUnloadCallback(
            plugin.name,
            makeMenuUnloadCallback(menuDef, additionalHamburgerMenu),
            instance.generation,
          )
          break
        }
        case 'chat': {
          additionalChatMenu.push(menuDef)
          addPluginUnloadCallback(plugin.name, makeMenuUnloadCallback(menuDef, additionalChatMenu), instance.generation)
          break
        }
        default: {
          throw new Error('Invalid location for button')
        }
      }
      return { id }
    },
    registerMCP: registerMCPModule,
    unregisterMCP: unregisterMCPModule,
    unregisterUIPart: (id: string) => {
      const removeFromMenuStore = (menuStore: MenuDef[]) => {
        const index = menuStore.findIndex((item) => item.id === id)
        if (index !== -1) {
          menuStore.splice(index, 1)
        }
      }

      removeFromMenuStore(additionalSettingsMenu)
      removeFromMenuStore(additionalFloatingActionButtons)
      removeFromMenuStore(additionalHamburgerMenu)
      removeFromMenuStore(additionalChatMenu)
    },
    log: (message: string) => {
      console.log(`[RisuAI Plugin: ${plugin.name}] ${message}`)
    },
    createMutationObserver(callback: SafeMutationCallback): SafeMutationObserver {
      return new SafeMutationObserver(callback, lifecycle)
    },
    onUnload: (callback: () => void) => {
      addPluginUnloadCallback(plugin.name, callback)
    },
    getFetchLogs: async () => {
      const unsafeFetchLog = getFetchLogs()
      const conf = await getPluginPermission(plugin.name, 'fetchLogs')
      assertV3InstanceCurrent(instance)
      if (!conf) {
        return null
      }
      return unsafeFetchLog.map((log) => {
        const url = new URL(log.url)
        return {
          url: url.origin + url.pathname,
          body: log.body,
          status: log.status,
          response: log.response,
        }
      })
    },

    alert: (msg: string) => {
      return alertNormal(msg)
    },
    alertConfirm: (msg: string) => {
      return alertConfirm(msg)
    },
    alertError: (msg: string) => {
      return alertError(msg)
    },
    getRuntimeInfo: () => {
      return {
        apiVersion: '3.0',
        platform: 'fastify',
        saveMethod: 'server',
        deviceLocalPluginStorage: isDeviceLocalPluginStorageEnabled(),
      }
    },
    getLocalPluginStorage: () => {
      assertDeviceLocalPluginStorageEnabled()
      return new SafeLocalPluginStorage()
    },
    checkCharOrder: checkCharOrder,
    requestPluginPermission: (permission: string) => {
      return getPluginPermission(plugin.name, permission as any)
    },
    //Internal use APIs
    _getOldKeys: () => {
      return Object.keys(oldApis)
    },
    _getPropertiesForInitialization: () => {
      const v = {
        apiVersion: '3.0',
        apiVersionCompatibleWith: ['3.0'],
      } as any

      v.list = Object.keys(v)

      return v
    },
    _getPluginStorage: oldApis.pluginStorage.getItem,
    _setPluginStorage: oldApis.pluginStorage.setItem,
    _removePluginStorage: oldApis.pluginStorage.removeItem,
    _clearPluginStorage: oldApis.pluginStorage.clear,
    _keyPluginStorage: oldApis.pluginStorage.key,
    _keysPluginStorage: oldApis.pluginStorage.keys,
    _lengthPluginStorage: oldApis.pluginStorage.length,
    _getSafeLocalStorage: oldApis.safeLocalStorage.getItem,
    _setSafeLocalStorage: oldApis.safeLocalStorage.setItem,
    _removeSafeLocalStorage: oldApis.safeLocalStorage.removeItem,
    _clearSafeLocalStorage: oldApis.safeLocalStorage.clear,
    _keySafeLocalStorage: oldApis.safeLocalStorage.key,
    _keysSafeLocalStorage: oldApis.safeLocalStorage.keys,
    searchTranslationCache: async (partialKey: string) => {
      return searchLLMCache(partialKey)
    },
    getTranslationCache: async (key: string) => {
      return getLLMCache(key)
    },
    _getAliases: () => {
      return {
        pluginStorage: {
          getItem: '_getPluginStorage',
          setItem: '_setPluginStorage',
          removeItem: '_removePluginStorage',
          clear: '_clearPluginStorage',
          key: '_keyPluginStorage',
          keys: '_keysPluginStorage',
          length: '_lengthPluginStorage',
        },
        safeLocalStorage: {
          getItem: '_getSafeLocalStorage',
          setItem: '_setSafeLocalStorage',
          removeItem: '_removeSafeLocalStorage',
          clear: '_clearSafeLocalStorage',
          key: '_keySafeLocalStorage',
          keys: '_keysSafeLocalStorage',
        },
      }
    },
    runLLMModel: async (options: {
      mode: ModelModeExtended
      messages: OpenAIChat[]
      staticModel?: string
      allowPlugins?: boolean
    }) => {
      return requestChatDataMain(
        {
          formated: options.messages,
          bias: {},
          staticModel: options.staticModel,

          // Calls into plugin-provided models are blocked by default to
          // guard against accidental IPC loops between provider plugins.
          // Plugin authors who need to reach the user's plugin-supplied
          // main or auxiliary model (e.g. a TTS preprocessor that
          // rewrites text with the configured otherAx model) can opt in
          // explicitly with `allowPlugins: true`, accepting responsibility
          // for avoiding provider-to-provider call loops.
          blockPlugins: !options.allowPlugins,
        },
        options.mode,
      )
    },
    sendChat: async (message: string) => {
      const conf = await getPluginPermission(plugin.name, 'sendChat')
      assertV3InstanceCurrent(instance)
      if (!conf) {
        return false
      }

      if (typeof message !== 'string') {
        throw new Error('Message must be a string')
      }

      if (get(doingChat)) {
        throw new Error('A chat is already in progress')
      }

      if (getModelInfo(getDatabase().aiModel).id.startsWith('pluginmodel:::')) {
        // Plugin-provided models are blocked from chat sends to keep plugin IPC
        // outside provider execution.
        throw new Error('Sending chat with plugin-based model is currently blocked')
      }

      const charId = get(selectedCharID)
      const char = getDatabase().characters[charId]
      if (!char) {
        throw new Error('No character selected')
      }

      const chat = char.chats[char.chatPage]
      if (!chat) {
        throw new Error('No active chat found')
      }

      if (message) {
        const appendResult = await appendCurrentChatUserMessageForSend(message)
        if (appendResult.status !== 'ok') {
          throw new Error(appendResult.error)
        }
      }

      await processSendChat(-1, {})

      return true
    },
    addPluginChannelListener: (channelName: string, callback: Function) => {
      pluginChannel.set(plugin.name + channelName, callback)
      addPluginUnloadCallback(plugin.name, () => {
        if (pluginChannel.get(plugin.name + channelName) === callback) {
          pluginChannel.delete(plugin.name + channelName)
        }
      })
    },
    postPluginChannelMessage: (pluginName: string, channelName: string, message: any) => {
      const currentPluginName = plugin.name
      const receiverPlugin = getDatabase().plugins.find((p) => p.name === pluginName)

      if (!receiverPlugin) {
        console.warn(
          `[RisuAI Plugin: ${currentPluginName}] Attempted to send message to non-existent plugin '${pluginName}' on channel '${channelName}'.`,
        )
        return
      }

      if (!receiverPlugin.allowedIPC?.includes(currentPluginName)) {
        console.warn(
          `[RisuAI Plugin: ${currentPluginName}] Attempted to send message to plugin '${pluginName}' but receiver plugin does not allow IPC communication from this plugin. declare //@allowed-ipc ${currentPluginName} in the reciver plugin script to allow IPC communication.`,
        )
        return
      }

      if (!plugin.allowedIPC?.includes(receiverPlugin.name)) {
        console.warn(
          `[RisuAI Plugin: ${currentPluginName}] Attempted to send message to plugin '${pluginName}' but the sender plugin does not allow IPC communication to this plugin. declare //@allowed-ipc ${receiverPlugin.name} in the sender plugin script to allow IPC communication.`,
        )
        return
      }

      const callback = pluginChannel.get(pluginName + channelName)
      if (callback) {
        callback(message, {
          sender: currentPluginName,
          channel: channelName,
        })
      }
    },
    saveSecretHeader: async (key: string, value: string | string[]) => {
      // Secret header storage is intentionally unavailable without write-only
      // plugin storage.
      console.warn(
        `[RisuAI Plugin: ${plugin.name}] saveServerSecret is not implemented yet. This API is intended for securely storing sensitive information like API keys with write-only access for plugins. Please avoid using this API until it is implemented.`,
      )
    },
  }
  return guardV3Api(api, instance)
}

export async function loadV3Plugins(plugins: RisuPlugin[]) {
  const generation = beginV3Generation()
  await Promise.all(
    [...v3PluginInstances].map(async (instance) => {
      await unloadV3PluginInstance(instance)
    }),
  )

  if (generation !== activeV3Generation) {
    return
  }

  const loadPromises = plugins.map((plugin) => executePluginV3(plugin, generation))
  await Promise.all(loadPromises)
}

export async function executePluginV3(plugin: RisuPlugin, generation = ensureV3Generation()) {
  if (generation !== activeV3Generation) {
    return
  }

  const alreadyRunning = v3PluginInstances.find(
    (p) => p.name === plugin.name && p.active && p.generation === generation,
  )
  if (alreadyRunning) {
    console.log(`[RisuAI Plugin: ${plugin.name}] Plugin is already running. Skipping load.`)
    return
  }

  const iframe = document.createElement('iframe')
  iframe.style.display = 'none'
  document.body.appendChild(iframe)
  const lifecycle = new PluginLifecycleCleanup()
  const instance: V3PluginInstance = {
    name: plugin.name,
    lifecycle,
    generation,
    active: true,
  }
  const host = new SandboxHost(makeRisuaiAPIV3(iframe, plugin, lifecycle, instance))
  instance.host = host
  v3PluginInstances.push(instance)
  try {
    assertV3InstanceCurrent(instance)
    host.run(iframe, plugin.script)
  } catch (error) {
    await unloadV3PluginInstance(instance)
    throw error
  }
  console.log(`[RisuAI Plugin: ${plugin.name}] Loaded API V3 plugin.`)
}

export function getV3PluginInstance(name: string) {
  return v3PluginInstances.find((p) => p.name === name && p.active)
}

export const __v3PluginLifecycleTestHooks = {
  async reset() {
    for (const instance of [...v3PluginInstances]) {
      await unloadV3PluginInstance(instance)
    }
    activeV3Generation = 0
    pluginUnloadCallbacks.clear()
    pluginChannel.clear()
    v3ProviderRegistrations.splice(0, v3ProviderRegistrations.length)
    v3SyncedProviderRegistrations.clear()
    registeredV3ProviderUnloadCallbacks.clear()
    customV3ProviderMetaStore.splice(0, customV3ProviderMetaStore.length)
    additionalSettingsMenu.splice(0, additionalSettingsMenu.length)
    additionalFloatingActionButtons.splice(0, additionalFloatingActionButtons.length)
    additionalHamburgerMenu.splice(0, additionalHamburgerMenu.length)
    additionalChatMenu.splice(0, additionalChatMenu.length)
    bodyIntercepterStore.splice(0, bodyIntercepterStore.length)
    pluginV2.providers.clear()
    pluginV2.providerOptions.clear()
    syncCustomProviderStoreFromMap()
  },
  createLifecycle() {
    return new PluginLifecycleCleanup()
  },
  createSafeDocument(lifecycle: PluginLifecycleCleanup) {
    return new SafeDocument(document, lifecycle)
  },
  createMutationObserver(lifecycle: PluginLifecycleCleanup, callback: SafeMutationCallback) {
    return new SafeMutationObserver(callback, lifecycle)
  },
  createApi(plugin: RisuPlugin): Record<string, unknown> {
    const iframe = document.createElement('iframe')
    const lifecycle = new PluginLifecycleCleanup()
    const instance: V3PluginInstance = {
      name: plugin.name,
      lifecycle,
      generation: ensureV3Generation(),
      active: true,
    }
    return makeRisuaiAPIV3(iframe, plugin, lifecycle, instance) as Record<string, unknown>
  },
  createTrackedApi(plugin: RisuPlugin): { api: Record<string, unknown>; instance: V3PluginInstance } {
    const iframe = document.createElement('iframe')
    const lifecycle = new PluginLifecycleCleanup()
    const instance: V3PluginInstance = {
      name: plugin.name,
      lifecycle,
      generation: ensureV3Generation(),
      active: true,
    }
    const api = makeRisuaiAPIV3(iframe, plugin, lifecycle, instance) as Record<string, unknown>
    v3PluginInstances.push(instance)
    return { api, instance }
  },
  createApiForInstance(plugin: RisuPlugin, instance: V3PluginInstance): Record<string, unknown> {
    const iframe = document.createElement('iframe')
    return makeRisuaiAPIV3(iframe, plugin, instance.lifecycle, instance) as Record<string, unknown>
  },
  beginGeneration() {
    return beginV3Generation()
  },
  unloadInstance(instance: V3PluginInstance) {
    return unloadV3PluginInstance(instance)
  },
  registerProvider(
    pluginName: string,
    name: string,
    handler: V3ProviderRegistration['handler'] = async () => ({
      success: true,
      content: pluginName,
    }),
    options: PluginV2ProviderOptions = {},
  ) {
    registerV3Provider({
      pluginName,
      generation: activeV3Generation,
      name,
      handler,
      options,
      modelData: {
        id: `pluginmodel:::${name}`,
        name,
        shortName: name,
        fullName: name,
        internalID: `pluginmodel:::${name}`,
        provider: LLMProvider.AsIs,
        format: LLMFormat.Plugin,
        flags: [LLMFlags.hasFullSystemPrompt],
        parameters: ['temperature'],
        tokenizer: LLMTokenizer.Unknown,
      },
    })
  },
  addUnloadCallback(pluginName: string, callback: () => void | Promise<void>) {
    addPluginUnloadCallback(pluginName, callback)
  },
  unloadPlugin(pluginName: string) {
    return unloadV3Plugin(pluginName)
  },
}

globalThis.__debugV3Plugin = (code: string | Function, pluginName: string = '') => {
  if (code instanceof Function) {
    code = `(${code.toString()})()`
  }
  if (pluginName === '') {
    const instance = v3PluginInstances[0]
    if (!instance?.host) {
      throw new Error('No V3 plugin is loaded.')
    }
    return instance.host.executeInIframe(code)
  }
  const instance = v3PluginInstances.find((p) => p.name === pluginName)
  if (!instance?.host) {
    throw new Error(`Plugin ${pluginName} not found.`)
  }
  return instance.host.executeInIframe(code)
}
