import { writable } from 'svelte/store'
import type { character, customscript } from './storage/database.svelte'
import { type simpleCharacterArgument } from './parser/parser.svelte'
import type { alertData } from './alert'
import { moduleUpdate } from './process/modules'
import { resetScriptCache } from './process/scripts'
import type { hubType } from './characterCards'
import type { PluginSafetyErrors } from './plugins/pluginSafety'
import type { ActiveChatTarget } from './chatCommands'
import { getResourceDatabase } from './server/resourceState.svelte'

function updateSize() {
  SizeStore.set({
    w: window.innerWidth,
    h: window.innerHeight,
  })
  DynamicGUI.set(window.innerWidth <= 1024)
}

export const SizeStore = writable({
  w: 0,
  h: 0,
})

export const loadedStore = writable(false)
export const DynamicGUI = writable(false)
export const sideBarClosing = writable(false)
export const sideBarStore = writable(window.innerWidth > 1024)
export const selectedCharID = writable(-1)
export const CurrentTriggerIdStore = writable<string | null>(null)
export const CharEmotion = writable({} as { [key: string]: [string, string, number][] })
export const ViewBoxsize = writable({ width: 12 * 16, height: 12 * 16 }) // Default width and height in pixels
export const settingsOpen = writable(false)
export const botMakerMode = writable(false)
export const moduleBackgroundEmbedding = writable('')
export const openPresetList = writable(false)
export const openPersonaList = writable(false)
export type GenerationSettingsPickerMode = 'global' | 'active-chat-generation-settings'
export type PresetPickerKind = 'model' | 'prompt' | 'legacy'
export const presetListModalStore = $state({
  mode: 'global' as GenerationSettingsPickerMode,
  kind: 'model' as PresetPickerKind,
  target: null as ActiveChatTarget | null,
})
export const personaListModalStore = $state({
  mode: 'global' as GenerationSettingsPickerMode,
  target: null as ActiveChatTarget | null,
})
export const bookmarkListOpen = writable(false)
export const MobileGUI = writable(false)
export const MobileGUIStack = writable(0)
export const MobileSideBar = writable(0)
export const SettingsMenuIndex = writable(-1)
export const ReloadGUIPointer = writable(0)
export const VariableReloadGUIPointer = writable(0)
export const ReloadChatPointer = writable({} as Record<number, number>)
export const ScrollToMessageStore = $state({ value: -1 })
export const OpenRealmStore = writable(false)
export const RealmInitialOpenChar = writable<null | hubType>(null)
export const PlaygroundStore = writable(0)
export const HideIconStore = writable(false)
export const CustomCSSStore = writable('')
export const SafeModeStore = writable(false)
export const MobileSearch = writable('')
export const CharConfigSubMenu = writable(0)
export const CustomGUISettingMenuStore = writable(false)
export const alertStore = writable({
  type: 'none',
  msg: 'n',
} as alertData)
export const hypaV3ModalOpen = writable(false)
export const hypaV3ProgressStore = writable({
  open: false,
  miniMsg: '',
  msg: '',
  subMsg: '',
})
export const selIdState = $state({
  selId: -1,
})

CustomCSSStore.subscribe((css) => {
  console.log(css)
  const q = document.querySelector('#customcss')
  if (q) {
    q.innerHTML = css
  } else {
    const s = document.createElement('style')
    s.id = 'customcss'
    s.innerHTML = css
    document.body.appendChild(s)
  }
})

export function createSimpleCharacter(char: character, customscript: customscript[] | undefined = char.customscript) {
  if (!char) {
    return null
  }

  const simpleChar: simpleCharacterArgument = {
    type: 'simple',
    customscript,
    chaId: char.chaId,
    additionalAssets: char.additionalAssets,
    virtualscript: char.virtualscript,
    emotionImages: char.emotionImages,
    triggerscript: char.triggerscript,
  }

  return simpleChar
}

updateSize()
window.addEventListener('resize', updateSize)
openPresetList.subscribe((open) => {
  if (!open) {
    presetListModalStore.mode = 'global'
    presetListModalStore.kind = 'model'
    presetListModalStore.target = null
  }
})

openPersonaList.subscribe((open) => {
  if (!open) {
    personaListModalStore.mode = 'global'
    personaListModalStore.target = null
  }
})

export function openPresetListModal(
  mode: GenerationSettingsPickerMode = 'global',
  kind: PresetPickerKind = 'model',
  target: ActiveChatTarget | null = null,
) {
  presetListModalStore.mode = mode
  presetListModalStore.kind = kind
  presetListModalStore.target = mode === 'active-chat-generation-settings' ? target : null
  openPresetList.set(true)
}

export function closePresetListModal() {
  openPresetList.set(false)
}

export function openPersonaListModal(
  mode: GenerationSettingsPickerMode = 'global',
  target: ActiveChatTarget | null = null,
) {
  personaListModalStore.mode = mode
  personaListModalStore.target = mode === 'active-chat-generation-settings' ? target : null
  openPersonaList.set(true)
}

export function closePersonaListModal() {
  openPersonaList.set(false)
}

export const LoadingStatusState = $state({
  text: '',
})

export const QuickSettings = $state({
  open: false,
  index: 0,
})

export const pluginAlertModalStore = $state({
  open: false,
  errors: [] as PluginSafetyErrors[],
})

export const disableHighlight = writable(true)

export type MenuDef = {
  name: string
  icon: string
  iconType: 'html' | 'img' | 'none'
  callback: any
  id: string
}

export const additionalSettingsMenu = $state([] as MenuDef[])
export const additionalFloatingActionButtons = $state([] as MenuDef[])
export const additionalHamburgerMenu = $state([] as MenuDef[])
export const additionalChatMenu = $state([] as MenuDef[])
export const bodyIntercepterStore = $state(
  [] as {
    id: string
    callback: (body: any, type: string) => Promise<any>
  }[],
)
export const easyPanelStore = $state({
  open: false,
})
export const popupStore = $state({
  children: null as null | import('svelte').Snippet,
  mouseX: 0,
  mouseY: 0,
  openId: 0,
  trigger: null as HTMLButtonElement | null,
})
export const popUpEditorStore = $state({
  open: false,
  value: '',
  mode: 'default' as 'default',
  language: 'markdown' as string,
  sessionId: 0,
})

let nextPopupEditorSessionId = 0

export function openPopupEditorSession(value: string, language = 'markdown'): number {
  const sessionId = ++nextPopupEditorSessionId
  popUpEditorStore.value = value
  popUpEditorStore.mode = 'default'
  popUpEditorStore.language = language
  popUpEditorStore.sessionId = sessionId
  popUpEditorStore.open = true
  return sessionId
}

export function isPopupEditorSessionCurrent(sessionId: number): boolean {
  return popUpEditorStore.sessionId === sessionId
}

export function closePopupEditorSession(sessionId: number): boolean {
  if (!isPopupEditorSessionCurrent(sessionId)) return false
  popUpEditorStore.open = false
  return true
}

export const loadoutModalStore = $state({
  open: false,
})

export const irisStore = $state({
  open: false,
})

export const customSideBarConfigDialogStore = $state({
  open: false,
})

// Svelte does not make Set mutations reactive, so this uses an array.
export const hotReloading = $state<string[]>([])

export function reloadGuiAfterDefinitionChange() {
  ReloadChatPointer.set({})
  resetScriptCache()
  ReloadGUIPointer.update((value) => value + 1)
}

export function reloadGuiDisplay() {
  ReloadGUIPointer.update((value) => value + 1)
}

export function refreshVariableOnlyGui() {
  VariableReloadGUIPointer.update((value) => value + 1)
}

export function reloadChatAt(index: number | string) {
  const chatIndex = Number(index)
  if (!Number.isFinite(chatIndex)) return
  ReloadChatPointer.update((value) => ({
    ...value,
    [chatIndex]: (value[chatIndex] ?? 0) + 1,
  }))
}

// The modules `$effect` below used to register its dependency on the modules
// array via a whole-value snapshot — a deep clone of every
// module (lorebook entries, scripts, and triggers included) on every fire,
// discarded immediately. `moduleUpdate()` only consumes each module's
// identity plus its `hideIcon` / `backgroundEmbedding` fields, so reading
// exactly those (and the array length, for adds/removes) registers every
// signal the effect needs with zero cloning. Exported for the regression
// test, which proves an unrelated deep module edit no longer re-runs the
// effect while the consumed fields still do.
export interface ModuleUpdateSignalSource {
  id?: string
  hideIcon?: boolean
  backgroundEmbedding?: string
}

export function readModuleUpdateSignals(modules: readonly ModuleUpdateSignalSource[] | undefined): void {
  if (!modules) return
  void modules.length
  for (const module of modules) {
    void module?.id
    void module?.hideIcon
    void module?.backgroundEmbedding
  }
}

function isServerCharacterShellRow(character: unknown): boolean {
  return (
    !!character &&
    typeof character === 'object' &&
    !Array.isArray(character) &&
    (character as { __serverCharacterShell?: unknown }).__serverCharacterShell === true
  )
}

$effect.root(() => {
  selectedCharID.subscribe((v) => {
    selIdState.selId = v

    const database = getResourceDatabase()
    if (database.characters?.[selIdState.selId]) {
      if (database.hypaV3 && database.hypaV3Presets?.[database.hypaV3PresetId]?.settings?.alwaysToggleOn) {
        const char = database.characters[selIdState.selId]
        if (!isServerCharacterShellRow(char) && !char.supaMemory && char.chaId) {
          const characterId = char.chaId
          void import('./characterCommands').then(({ setCharacterSupaMemory }) => {
            setCharacterSupaMemory(characterId, true)
          })
        }
      }
    }
  })
  $effect(() => {
    const database = getResourceDatabase()
    const character = database.characters?.[selIdState.selId]
    readModuleUpdateSignals(database.modules)
    database.enabledModules
    database.enabledModules?.length
    character?.chats?.[character.chatPage]?.modules?.length
    character?.hideChatIcon
    character?.backgroundHTML
    database.moduleIntergration
    moduleUpdate()
  })
})
