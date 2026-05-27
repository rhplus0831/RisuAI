<script lang="ts">
  import { language } from 'src/lang'
  import { DBState } from 'src/ts/stores.svelte'
  import { applyServerBackedSetting } from 'src/ts/server/settingsBridge.svelte'
  import type { Hotkey } from 'src/ts/defaulthotkeys'

  // Hotkey edits must not mutate `DBState.db.hotkeys` in place: it is a
  // read-only server projection in Fastify mode. Build a fresh array and route
  // it through the server-backed settings patch, which applies the optimistic
  // projection update inside a trusted write scope and persists it.
  function patchHotkey(index: number, patch: Partial<Hotkey>): void {
    const next = DBState.db.hotkeys.map((hotkey, i) =>
      i === index ? { ...hotkey, ...patch } : { ...hotkey },
    )
    applyServerBackedSetting('hotkeys', next)
  }
</script>

{#if window.innerWidth < 768}
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
      {#each DBState.db.hotkeys as hotkey, index}
        <tr>
          <td>{language.hotkeyDesc[hotkey.action]}</td>
          <td>
            <button
              class:text-textcolor={hotkey.ctrl}
              class:text-textcolor2={!hotkey.ctrl}
              onclick={() => {
                patchHotkey(index, { ctrl: !hotkey.ctrl })
              }}
            >
              Ctrl
            </button>
          </td>
          <td>
            <button
              class:text-textcolor={hotkey.shift}
              class:text-textcolor2={!hotkey.shift}
              onclick={() => {
                patchHotkey(index, { shift: !hotkey.shift })
              }}
            >
              Shift
            </button>
          </td>
          <td>
            <button
              class:text-textcolor={hotkey.alt}
              class:text-textcolor2={!hotkey.alt}
              onclick={() => {
                patchHotkey(index, { alt: !hotkey.alt })
              }}
            >
              Alt
            </button>
          </td>
          <td>
            <input
              value={hotkey.key === ' ' ? 'SPACE' : hotkey.key?.toLocaleUpperCase()}
              class="bg-bgcolor border-none w-16"
              onkeydown={(e) => {
                e.preventDefault()
                patchHotkey(index, { key: e.key })
              }}
            />
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
