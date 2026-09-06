<script lang="ts">
  import { language } from 'src/lang'
  import { settingsResourceState } from 'src/ts/server/resourceState.svelte'
  import { applyServerBackedSetting } from 'src/ts/server/settingsOwner.svelte'
  import type { Hotkey } from 'src/ts/defaulthotkeys'

  let viewportWidth = $state(window.innerWidth)

  function updateViewportWidth(): void {
    viewportWidth = window.innerWidth
  }

  // Replace the projected array instead of mutating a hotkey row in place.
  function patchHotkey(index: number, patch: Partial<Hotkey>): void {
    const hotkeys = readHotkeys(settingsResourceState.value.hotkeys)
    const next = hotkeys.map((hotkey, i) => (i === index ? { ...hotkey, ...patch } : { ...hotkey }))
    applyServerBackedSetting('hotkeys', next)
  }

  function readHotkeys(value: unknown): Hotkey[] {
    if (!Array.isArray(value)) return []
    const actions = new Set<string>()
    for (const hotkey of value) {
      if (!hotkey || typeof hotkey !== 'object' || Array.isArray(hotkey)) return []
      const action = (hotkey as { action?: unknown }).action
      if (typeof action !== 'string' || action.length === 0 || actions.has(action)) return []
      actions.add(action)
    }
    return value as Hotkey[]
  }

  let hotkeys = $derived(
    settingsResourceState.groupStatuses.sidebar === 'ready' ? readHotkeys(settingsResourceState.value.hotkeys) : [],
  )

  function recordHotkey(event: KeyboardEvent & { currentTarget: HTMLInputElement }, index: number): void {
    if (event.key === 'Tab') return

    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.currentTarget.blur()
      return
    }

    patchHotkey(index, { key: event.key })
  }
</script>

<svelte:window onresize={updateViewportWidth} />

{#if viewportWidth < 768}
  <span class="text-red-500">
    {language.screenTooSmall}
  </span>
{:else}
  <table>
    <thead>
      <tr>
        <th>{language.hotkey}</th>
      </tr>
    </thead>
    <tbody>
      {#each hotkeys as hotkey, index}
        <tr>
          <td>{language.hotkeyDesc[hotkey.action]}</td>
          <td>
            <button
              aria-label={`${language.hotkeyDesc[hotkey.action]}: Ctrl`}
              aria-pressed={hotkey.ctrl}
              class:text-textcolor={hotkey.ctrl}
              class:text-textcolor2={!hotkey.ctrl}
              onclick={() => {
                patchHotkey(index, { ctrl: !hotkey.ctrl })
              }}>
              Ctrl
            </button>
          </td>
          <td>
            <button
              aria-label={`${language.hotkeyDesc[hotkey.action]}: Shift`}
              aria-pressed={hotkey.shift}
              class:text-textcolor={hotkey.shift}
              class:text-textcolor2={!hotkey.shift}
              onclick={() => {
                patchHotkey(index, { shift: !hotkey.shift })
              }}>
              Shift
            </button>
          </td>
          <td>
            <button
              aria-label={`${language.hotkeyDesc[hotkey.action]}: Alt`}
              aria-pressed={hotkey.alt}
              class:text-textcolor={hotkey.alt}
              class:text-textcolor2={!hotkey.alt}
              onclick={() => {
                patchHotkey(index, { alt: !hotkey.alt })
              }}>
              Alt
            </button>
          </td>
          <td>
            <input
              aria-label={`${language.hotkeyDesc[hotkey.action]} ${language.hotkey}`}
              value={hotkey.key === ' ' ? 'SPACE' : hotkey.key?.toLocaleUpperCase()}
              class="bg-bgcolor border-none w-16"
              onkeydown={(e) => {
                recordHotkey(e, index)
              }} />
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
