<script lang="ts">
  import { language } from 'src/lang'
  import BaseRoundedButton from 'src/lib/UI/BaseRoundedButton.svelte'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import TextAreaInput from 'src/lib/UI/GUI/TextAreaInput.svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import { alertConfirm, alertSelect } from 'src/ts/alert'
  import { getCharImage } from 'src/ts/characters'
  import {
    changeUserPersona,
    exportUserPersona,
    importUserPersona,
    normalizePersonaIds,
    saveUserPersona,
    selectUserImg,
  } from 'src/ts/persona'
  import Sortable from 'sortablejs/modular/sortable.core.esm.js'
  import { onDestroy, onMount, untrack } from 'svelte'
  import { sleep, sortableOptions } from 'src/ts/util'
  import { DBState } from 'src/ts/stores.svelte'
  import { v4 } from 'uuid'
  import {
    canUseServerCommands,
    createPersonaCommand,
    deletePersonaCommand,
    reorderPersonasCommand,
    runServerCommand,
    updatePersonaCommand,
    type PersonaSnapshot,
  } from 'src/ts/server/commands'
  import { withTrustedServerProjectionWrite } from 'src/ts/server/projectionWriteGuard.svelte'

  let stb: Sortable = null
  let ele: HTMLDivElement = $state()
  let sorted = $state(0)
  let selectedId: string = null
  const pendingPersonaUpdate = {
    timer: null as ReturnType<typeof setTimeout> | null,
    previous: null as PersonaStateSnapshot | null,
    attempted: null as PersonaStateSnapshot | null,
  }
  let personaWatcherInitialized = false
  let previousPersonaSnapshot = ''
  let previousPersonaState: PersonaStateSnapshot | null = null
  let suppressPersonaRollback = false

  type Persona = (typeof DBState.db.personas)[number]
  interface PersonaStateSnapshot {
    personas: Persona[]
    selectedPersona: number
    username: string
    userIcon: string
    personaPrompt: string
    userNote: string
  }

  function cloneJsonValue<T>(value: T): T {
    if (value === undefined) return value
    return JSON.parse(JSON.stringify(value)) as T
  }

  function snapshotJson(value: unknown): string {
    const snapshot = JSON.stringify(value)
    return snapshot === undefined ? '__undefined__' : snapshot
  }

  function currentPersonaStateSnapshot(): PersonaStateSnapshot {
    return {
      personas: cloneJsonValue(DBState.db.personas ?? []),
      selectedPersona: DBState.db.selectedPersona,
      username: DBState.db.username,
      userIcon: DBState.db.userIcon,
      personaPrompt: DBState.db.personaPrompt,
      userNote: DBState.db.userNote,
    }
  }

  function restorePersonaState(snapshot: PersonaStateSnapshot): void {
    suppressPersonaRollback = true
    try {
      withTrustedServerProjectionWrite(() => {
        DBState.db.personas = cloneJsonValue(snapshot.personas)
        DBState.db.selectedPersona = snapshot.selectedPersona
        DBState.db.username = snapshot.username
        DBState.db.userIcon = snapshot.userIcon
        DBState.db.personaPrompt = snapshot.personaPrompt
        DBState.db.userNote = snapshot.userNote
      })
    } finally {
      queueMicrotask(() => {
        suppressPersonaRollback = false
      })
    }
  }

  function runWithoutPersonaWatcher(mutator: () => void): void {
    suppressPersonaRollback = true
    try {
      withTrustedServerProjectionWrite(mutator)
    } finally {
      setTimeout(() => {
        suppressPersonaRollback = false
      }, 0)
    }
  }

  function updateSelectedPersonaField(
    field: 'username' | 'userNote' | 'personaPrompt',
    value: string,
  ): void {
    withTrustedServerProjectionWrite(() => {
      DBState.db[field] = value
    })
  }

  function updateSelectedPersonaLargePortrait(value: boolean): void {
    withTrustedServerProjectionWrite(() => {
      DBState.db.personas[DBState.db.selectedPersona].largePortrait = value
    })
  }

  function selectedPersonaId(): string | null {
    normalizePersonaIds()
    return DBState.db.personas[DBState.db.selectedPersona]?.id ?? null
  }

  function selectedPersonaPatch(): PersonaSnapshot {
    return {
      name: DBState.db.username,
      icon: DBState.db.userIcon,
      personaPrompt: DBState.db.personaPrompt,
      note: DBState.db.userNote,
      largePortrait: DBState.db.personas[DBState.db.selectedPersona]?.largePortrait ?? false,
    }
  }

  function dispatchCreatePersona(persona: Persona, previous: PersonaStateSnapshot): void {
    if (!canUseServerCommands()) return
    const attempted = currentPersonaStateSnapshot()
    void runServerCommand({
      command: (baseRevision) =>
        createPersonaCommand({
          baseRevision,
          persona: cloneJsonValue(persona) as PersonaSnapshot,
          mirrorLegacyProfile: true,
        }),
      rollback: () => restorePersonaState(previous),
    })
    pendingPersonaUpdate.attempted = attempted
  }

  function dispatchDeletePersona(
    personaId: string,
    selectPersonaId: string | undefined,
    previous: PersonaStateSnapshot,
  ): void {
    if (!canUseServerCommands()) return
    void runServerCommand({
      command: (baseRevision) =>
        deletePersonaCommand({
          baseRevision,
          personaId,
          selectPersonaId,
          mirrorLegacyProfile: true,
          saveCurrent: true,
        }),
      rollback: () => restorePersonaState(previous),
    })
  }

  function dispatchReorderPersonas(previous: PersonaStateSnapshot): void {
    if (!canUseServerCommands()) return
    normalizePersonaIds()
    const attempted = currentPersonaStateSnapshot()
    void runServerCommand({
      command: (baseRevision) =>
        reorderPersonasCommand({
          baseRevision,
          personaIds: DBState.db.personas.map((persona) => persona.id),
        }),
      rollback: () => {
        if (snapshotJson(currentPersonaStateSnapshot()) === snapshotJson(attempted)) {
          restorePersonaState(previous)
        }
      },
    })
  }

  function queueSelectedPersonaUpdate(previous: PersonaStateSnapshot): void {
    if (!canUseServerCommands() || suppressPersonaRollback) return
    const personaId = selectedPersonaId()
    if (!personaId) return
    pendingPersonaUpdate.previous ??= previous
    pendingPersonaUpdate.attempted = currentPersonaStateSnapshot()
    if (pendingPersonaUpdate.timer) clearTimeout(pendingPersonaUpdate.timer)
    pendingPersonaUpdate.timer = setTimeout(() => {
      pendingPersonaUpdate.timer = null
      const commandPrevious = pendingPersonaUpdate.previous
      const commandAttempted = pendingPersonaUpdate.attempted
      pendingPersonaUpdate.previous = null
      pendingPersonaUpdate.attempted = null
      void runServerCommand({
        command: (baseRevision) =>
          updatePersonaCommand({
            baseRevision,
            personaId,
            patch: selectedPersonaPatch(),
            mirrorLegacyProfile: true,
          }),
        rollback: () => {
          if (
            commandPrevious &&
            commandAttempted &&
            snapshotJson(currentPersonaStateSnapshot()) === snapshotJson(commandAttempted)
          ) {
            restorePersonaState(commandPrevious)
          }
        },
      })
    }, 250)
  }

  $effect(() => {
    const current = snapshotJson({
      selectedPersona: DBState.db.selectedPersona,
      username: DBState.db.username,
      userIcon: DBState.db.userIcon,
      personaPrompt: DBState.db.personaPrompt,
      userNote: DBState.db.userNote,
      largePortrait: DBState.db.personas[DBState.db.selectedPersona]?.largePortrait ?? false,
    })
    if (!personaWatcherInitialized) {
      personaWatcherInitialized = true
      previousPersonaSnapshot = current
      previousPersonaState = currentPersonaStateSnapshot()
      return
    }
    if (suppressPersonaRollback) {
      previousPersonaSnapshot = current
      previousPersonaState = currentPersonaStateSnapshot()
      return
    }
    if (current === previousPersonaSnapshot) return
    const previous = previousPersonaState ?? currentPersonaStateSnapshot()
    previousPersonaSnapshot = current
    previousPersonaState = currentPersonaStateSnapshot()
    untrack(() => queueSelectedPersonaUpdate(previous))
  })

  const createStb = () => {
    stb = Sortable.create(ele, {
      onStart: async () => {
        normalizePersonaIds()
        selectedId = DBState.db.personas[DBState.db.selectedPersona].id
        saveUserPersona({ dispatch: false })
      },
      onEnd: async () => {
        const previous = currentPersonaStateSnapshot()
        let idx: number[] = []
        ele.querySelectorAll('[data-risu-idx]').forEach((e, i) => {
          idx.push(parseInt(e.getAttribute('data-risu-idx')))
        })
        let newValue: {
          personaPrompt: string
          name: string
          icon: string
          note?: string
          largePortrait?: boolean
          id?: string
        }[] = []
        idx.forEach((i) => {
          newValue.push(DBState.db.personas[i])
        })
        runWithoutPersonaWatcher(() => {
          DBState.db.personas = newValue
          const selectedPersona = DBState.db.personas.findIndex((e) => e.id === selectedId)
          DBState.db.selectedPersona = selectedPersona !== -1 ? selectedPersona : 0
        })
        dispatchReorderPersonas(previous)
        try {
          stb.destroy()
        } catch (error) {}
        sorted += 1
        await sleep(1)
        createStb()
      },
      ...sortableOptions,
    })
  }

  onMount(createStb)

  onDestroy(() => {
    if (stb) {
      try {
        stb.destroy()
      } catch (error) {}
    }
  })
</script>

<h2 class="mb-2 text-2xl font-bold mt-2">{language.persona}</h2>

{#key sorted}
  <div
    class="p-4 rounded-md border-darkborderc border mb-2 flex-wrap flex gap-2 w-full max-w-full min-w-0"
    bind:this={ele}
  >
    {#each DBState.db.personas as persona, i}
      <button
        data-risu-idx={i}
        onclick={() => {
          runWithoutPersonaWatcher(() => {
            changeUserPersona(i)
          })
        }}
      >
        {#if persona.icon === ''}
          <div
            class="rounded-md h-20 w-20 shadow-lg bg-textcolor2 cursor-pointer hover:text-green-500"
            class:ring-3={i === DBState.db.selectedPersona}
          ></div>
        {:else}
          {#await getCharImage(persona.icon, 'css')}
            <div
              class="rounded-md h-20 w-20 shadow-lg bg-textcolor2 cursor-pointer hover:text-green-500"
              class:ring-3={i === DBState.db.selectedPersona}
            ></div>
          {:then im}
            <div
              class="rounded-md h-20 w-20 shadow-lg bg-textcolor2 cursor-pointer hover:text-green-500"
              style={im}
              class:ring-3={i === DBState.db.selectedPersona}
            ></div>
          {/await}
        {/if}
      </button>
    {/each}
    <div class="flex justify-center items-center ml-2 mr-2">
      <BaseRoundedButton
        onClick={async () => {
          const sel = parseInt(
            await alertSelect([language.createfromScratch, language.importCharacter]),
          )
          if (sel === 0) {
            const previous = currentPersonaStateSnapshot()
            const persona = {
              id: v4(),
              name: 'New Persona',
              icon: '',
              personaPrompt: '',
              note: '',
            }
            runWithoutPersonaWatcher(() => {
              DBState.db.personas.push(persona)
              DBState.db.selectedPersona = DBState.db.personas.length - 1
              DBState.db.username = persona.name
              DBState.db.userIcon = persona.icon
              DBState.db.personaPrompt = persona.personaPrompt
              DBState.db.userNote = persona.note
            })
            dispatchCreatePersona(persona, previous)
          } else if (sel === 1) {
            await importUserPersona()
          }
        }}
        ><svg viewBox="0 0 24 24" width="1.2em" height="1.2em"
          ><path
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 6v6m0 0v6m0-6h6m-6 0H6"
          /></svg
        >
      </BaseRoundedButton>
    </div>
  </div>
{/key}

<div class="flex w-full items-starts rounded-md border-darkborderc border p-4 max-w-full flex-wrap">
  <div class="flex flex-col mt-4 mr-4">
    <button
      onclick={() => {
        selectUserImg()
      }}
    >
      {#if DBState.db.userIcon === ''}
        <div
          class="rounded-md h-28 w-28 shadow-lg bg-textcolor2 cursor-pointer hover:text-green-500"
        ></div>
      {:else}
        {#await getCharImage(DBState.db.userIcon, DBState.db.personas[DBState.db.selectedPersona].largePortrait ? 'lgcss' : 'css')}
          <div
            class="rounded-md h-28 w-28 shadow-lg bg-textcolor2 cursor-pointer hover:text-green-500"
          ></div>
        {:then im}
          <div
            class="rounded-md h-28 w-28 shadow-lg bg-textcolor2 cursor-pointer hover:text-green-500"
            style={im}
          ></div>
        {/await}
      {/if}
    </button>
  </div>
  <div class="flex grow flex-col p-2 max-w-full">
    <span class="text-sm text-textcolor2">{language.name}</span>
    <TextInput
      marginBottom
      size="lg"
      placeholder="User"
      bind:value={
        () => DBState.db.username, (value) => updateSelectedPersonaField('username', value)
      }
    />
    <span class="text-sm text-textcolor2">{language.note}</span>
    {#if DBState.db.personaNote}
      <TextInput
        marginBottom
        size="lg"
        bind:value={
          () => DBState.db.userNote, (value) => updateSelectedPersonaField('userNote', value)
        }
        placeholder={`Put a unique identifier for this persona here.\nExample: [Alternate Hunters persona]`}
      />
    {/if}
    <span class="text-sm text-textcolor2">{language.description}</span>
    <TextAreaInput
      autocomplete="off"
      bind:value={
        () => DBState.db.personaPrompt,
        (value) => updateSelectedPersonaField('personaPrompt', value)
      }
      placeholder={`Put the description of this persona here.\nExample: [<user> is a 20 year old girl.]`}
    />
    <div class="flex gap-2 mt-4 max-w-full flex-wrap">
      <Button onclick={exportUserPersona}>{language.export}</Button>
      <Button onclick={importUserPersona}>{language.import}</Button>

      <Button
        styled="danger"
        onclick={async () => {
          if (DBState.db.personas.length === 1) {
            return
          }
          const d = await alertConfirm(
            `${language.removeConfirm}${DBState.db.personas[DBState.db.selectedPersona].name}`,
          )
          if (d) {
            normalizePersonaIds()
            const previous = currentPersonaStateSnapshot()
            saveUserPersona({ dispatch: false })
            const personaId = DBState.db.personas[DBState.db.selectedPersona].id
            let personas = [...DBState.db.personas]
            personas.splice(DBState.db.selectedPersona, 1)
            let selectedId = ''
            runWithoutPersonaWatcher(() => {
              DBState.db.personas = personas
              DBState.db.selectedPersona = 0
              const selected = DBState.db.personas[0]
              DBState.db.username = selected.name
              DBState.db.userIcon = selected.icon
              DBState.db.personaPrompt = selected.personaPrompt
              DBState.db.userNote = selected.note
              selectedId = selected.id
            })
            dispatchDeletePersona(personaId, selectedId, previous)
          }
        }}>{language.remove}</Button
      >
      <Check
        bind:check={
          () => DBState.db.personas[DBState.db.selectedPersona].largePortrait,
          (value) => updateSelectedPersonaLargePortrait(value)
        }>{language.largePortrait}</Check
      >
    </div>
  </div>
</div>
