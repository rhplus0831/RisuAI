<script lang="ts">
  import {
    DownloadIcon,
    HardDriveUploadIcon,
    PencilIcon,
    PlusIcon,
    TrashIcon,
  } from '@lucide/svelte'
  import Help from 'src/lib/Others/Help.svelte'
  import NumberInput from 'src/lib/UI/GUI/NumberInput.svelte'
  import TextAreaInput from 'src/lib/UI/GUI/TextAreaInput.svelte'
  import { alertConfirm, alertError, alertInput, alertNormal } from 'src/ts/alert'
  import { downloadFile } from 'src/ts/globalApi.svelte'
  import { DBState } from 'src/ts/stores.svelte'
  import {
    canUseServerCommands,
    createTranslatorPresetCommand,
    deleteTranslatorPresetCommand,
    runServerCommand,
    selectTranslatorPresetCommand,
    updateTranslatorPresetCommand,
    type ServerCommandResult,
    type TranslatorPresetSnapshot,
  } from 'src/ts/server/commands'
  import {
    createTranslatorPreset,
    decodeTranslatorPresetFile,
    defaultTranslatorPrompt,
    encodeTranslatorPresetFile,
    getTranslatorPresetDownloadName,
    normalizeTranslatorPresetState,
    syncCurrentTranslatorPresetToLegacyFields,
    translatorPresetImportExtensions,
  } from 'src/ts/translator/presets'
  import { selectSingleFile } from 'src/ts/util'
  import { language } from 'src/lang'

  type TranslatorPreset = (typeof DBState.db.translatorPresets)[number]

  interface TranslatorPresetStateSnapshot {
    translatorPresets: TranslatorPreset[]
    translatorPresetId: number
    translatorPrompt: string
    translatorMaxResponse: number
  }

  const pendingTranslatorPresetUpdate = {
    timer: null as ReturnType<typeof setTimeout> | null,
    presetId: null as string | null,
    patch: {} as TranslatorPresetSnapshot,
    previous: null as TranslatorPresetStateSnapshot | null,
    attempted: null as TranslatorPresetStateSnapshot | null,
  }

  function cloneJsonValue<T>(value: T): T {
    if (value === undefined) return value
    return JSON.parse(JSON.stringify(value)) as T
  }

  function snapshotJson(value: unknown): string {
    const snapshot = JSON.stringify(value)
    return snapshot === undefined ? '__undefined__' : snapshot
  }

  function currentTranslatorPresetStateSnapshot(): TranslatorPresetStateSnapshot {
    return {
      translatorPresets: cloneJsonValue(DBState.db.translatorPresets ?? []),
      translatorPresetId: DBState.db.translatorPresetId,
      translatorPrompt: DBState.db.translatorPrompt,
      translatorMaxResponse: DBState.db.translatorMaxResponse,
    }
  }

  function restoreTranslatorPresetState(snapshot: TranslatorPresetStateSnapshot): void {
    DBState.db.translatorPresets = cloneJsonValue(snapshot.translatorPresets)
    DBState.db.translatorPresetId = snapshot.translatorPresetId
    DBState.db.translatorPrompt = snapshot.translatorPrompt
    DBState.db.translatorMaxResponse = snapshot.translatorMaxResponse
  }

  function createClientTranslatorPresetId(): string {
    return crypto.randomUUID()
  }

  function normalizeTranslatorPresets() {
    normalizeTranslatorPresetState(DBState.db)
  }

  function syncCurrentTranslatorPreset() {
    syncCurrentTranslatorPresetToLegacyFields(DBState.db)
  }

  function selectedTranslatorPresetId(): string | null {
    normalizeTranslatorPresets()
    return DBState.db.translatorPresets[DBState.db.translatorPresetId]?.id ?? null
  }

  function runTranslatorPresetCommand<T extends Record<string, unknown>>(
    command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
    rollback?: () => void,
  ): void {
    if (!canUseServerCommands()) return
    void runServerCommand({ command, rollback })
  }

  function dispatchCreateTranslatorPreset(
    preset: TranslatorPreset,
    previous: TranslatorPresetStateSnapshot,
  ): void {
    runTranslatorPresetCommand(
      (baseRevision) =>
        createTranslatorPresetCommand({
          baseRevision,
          preset: cloneJsonValue(preset) as TranslatorPresetSnapshot,
          select: true,
        }),
      () => restoreTranslatorPresetState(previous),
    )
  }

  function dispatchSelectTranslatorPreset(
    presetId: string,
    previous: TranslatorPresetStateSnapshot,
  ): void {
    runTranslatorPresetCommand(
      (baseRevision) =>
        selectTranslatorPresetCommand({
          baseRevision,
          presetId,
        }),
      () => restoreTranslatorPresetState(previous),
    )
  }

  function dispatchDeleteTranslatorPreset(
    presetId: string,
    selectPresetId: string | undefined,
    previous: TranslatorPresetStateSnapshot,
  ): void {
    runTranslatorPresetCommand(
      (baseRevision) =>
        deleteTranslatorPresetCommand({
          baseRevision,
          presetId,
          selectPresetId,
        }),
      () => restoreTranslatorPresetState(previous),
    )
  }

  function queueTranslatorPresetUpdate(
    presetId: string,
    patch: TranslatorPresetSnapshot,
    previous: TranslatorPresetStateSnapshot,
  ): void {
    if (!canUseServerCommands()) return
    if (pendingTranslatorPresetUpdate.presetId !== presetId && pendingTranslatorPresetUpdate.timer) {
      clearTimeout(pendingTranslatorPresetUpdate.timer)
      pendingTranslatorPresetUpdate.timer = null
      pendingTranslatorPresetUpdate.patch = {}
      pendingTranslatorPresetUpdate.previous = null
      pendingTranslatorPresetUpdate.attempted = null
    }

    pendingTranslatorPresetUpdate.presetId = presetId
    pendingTranslatorPresetUpdate.previous ??= previous
    pendingTranslatorPresetUpdate.attempted = currentTranslatorPresetStateSnapshot()
    pendingTranslatorPresetUpdate.patch = {
      ...pendingTranslatorPresetUpdate.patch,
      ...patch,
    }

    if (pendingTranslatorPresetUpdate.timer) clearTimeout(pendingTranslatorPresetUpdate.timer)
    pendingTranslatorPresetUpdate.timer = setTimeout(() => {
      pendingTranslatorPresetUpdate.timer = null
      const commandPresetId = pendingTranslatorPresetUpdate.presetId
      const commandPatch = pendingTranslatorPresetUpdate.patch
      const commandPrevious = pendingTranslatorPresetUpdate.previous
      const commandAttempted = pendingTranslatorPresetUpdate.attempted
      pendingTranslatorPresetUpdate.presetId = null
      pendingTranslatorPresetUpdate.patch = {}
      pendingTranslatorPresetUpdate.previous = null
      pendingTranslatorPresetUpdate.attempted = null

      if (!commandPresetId) return
      void runServerCommand({
        command: (baseRevision) =>
          updateTranslatorPresetCommand({
            baseRevision,
            presetId: commandPresetId,
            patch: commandPatch,
          }),
        rollback: () => {
          if (
            commandPrevious &&
            commandAttempted &&
            snapshotJson(currentTranslatorPresetStateSnapshot()) === snapshotJson(commandAttempted)
          ) {
            restoreTranslatorPresetState(commandPrevious)
          }
        },
      })
    }, 250)
  }
</script>

<span class="text-textcolor mt-4">Preset</span>
<select
  class={'border border-darkborderc focus:border-borderc rounded-md shadow-xs text-textcolor bg-transparent focus:ring-borderc focus:ring-2 focus:outline-hidden transition-colors duration-200 text-md px-4 py-2 mb-1'}
  bind:value={
    () => DBState.db.translatorPresetId,
    (value) => {
      const previous = currentTranslatorPresetStateSnapshot()
      DBState.db.translatorPresetId = Number(value)
      syncCurrentTranslatorPreset()
      const presetId = selectedTranslatorPresetId()
      if (presetId) dispatchSelectTranslatorPreset(presetId, previous)
    }
  }
>
  {#each DBState.db.translatorPresets as preset, i}
    <option class="bg-darkbg appearance-none" value={i}>{preset.name}</option>
  {/each}
</select>

<div class="flex items-center mb-4">
  <button
    class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
    onclick={() => {
      const previous = currentTranslatorPresetStateSnapshot()
      const newPreset = createTranslatorPreset()
      newPreset.id = createClientTranslatorPresetId()
      const presets = DBState.db.translatorPresets
      presets.push(newPreset)
      DBState.db.translatorPresets = presets
      DBState.db.translatorPresetId = DBState.db.translatorPresets.length - 1
      normalizeTranslatorPresets()
      dispatchCreateTranslatorPreset(
        DBState.db.translatorPresets[DBState.db.translatorPresetId],
        previous,
      )
    }}
  >
    <PlusIcon size={24} />
  </button>

  <button
    class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
    onclick={async () => {
      const presets = DBState.db.translatorPresets

      if (presets.length === 0) {
        alertError('There must be at least one preset.')
        return
      }

      const id = DBState.db.translatorPresetId
      const preset = presets[id]
      const newName = await alertInput(`Enter new name for ${preset.name}`, [], preset.name)

      if (!newName || newName.trim().length === 0) return

      const previous = currentTranslatorPresetStateSnapshot()
      const presetId = selectedTranslatorPresetId()
      preset.name = newName
      DBState.db.translatorPresets = presets
      syncCurrentTranslatorPreset()
      if (presetId) queueTranslatorPresetUpdate(presetId, { name: newName }, previous)
    }}
  >
    <PencilIcon size={24} />
  </button>

  <button
    class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
    onclick={async () => {
      const presets = DBState.db.translatorPresets

      if (presets.length <= 1) {
        alertError('There must be at least one preset.')
        return
      }

      const id = DBState.db.translatorPresetId
      const preset = presets[id]
      const confirmed = await alertConfirm(`${language.removeConfirm}${preset.name}`)

      if (!confirmed) return

      normalizeTranslatorPresets()
      const previous = currentTranslatorPresetStateSnapshot()
      const presetId = preset.id
      DBState.db.translatorPresetId = 0
      presets.splice(id, 1)
      DBState.db.translatorPresets = presets
      normalizeTranslatorPresets()
      if (presetId) {
        dispatchDeleteTranslatorPreset(
          presetId,
          DBState.db.translatorPresets[DBState.db.translatorPresetId]?.id,
          previous,
        )
      }
    }}
  >
    <TrashIcon size={24} />
  </button>

  <div class="ml-2 mr-4 w-px h-full bg-darkborderc"></div>

  <button
    class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
    onclick={async () => {
      try {
        const presets = DBState.db.translatorPresets

        if (presets.length === 0) {
          alertError('There must be at least one preset.')
          return
        }

        const preset = presets[DBState.db.translatorPresetId]
        await downloadFile(
          getTranslatorPresetDownloadName(preset.name),
          await encodeTranslatorPresetFile(preset),
        )
        alertNormal(language.successExport)
      } catch (error) {
        alertError(`${error}`)
      }
    }}
  >
    <DownloadIcon size={24} />
  </button>

  <button
    class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
    onclick={async () => {
      try {
        const selectedFile = await selectSingleFile(translatorPresetImportExtensions)

        if (!selectedFile) return

        const newPreset = await decodeTranslatorPresetFile(selectedFile.data)
        newPreset.id = createClientTranslatorPresetId()
        const previous = currentTranslatorPresetStateSnapshot()
        const presets = DBState.db.translatorPresets

        presets.push(newPreset)
        DBState.db.translatorPresets = presets
        DBState.db.translatorPresetId = DBState.db.translatorPresets.length - 1
        normalizeTranslatorPresets()
        dispatchCreateTranslatorPreset(
          DBState.db.translatorPresets[DBState.db.translatorPresetId],
          previous,
        )

        alertNormal(language.successImport)
      } catch (error) {
        alertError(`${error}`)
      }
    }}
  >
    <HardDriveUploadIcon size={24} />
  </button>
</div>

{#if DBState.db.translatorPresets?.[DBState.db.translatorPresetId]}
  {@const preset = DBState.db.translatorPresets[DBState.db.translatorPresetId]}
  <span class="text-textcolor mt-4">{language.translationResponseSize}</span>
  <NumberInput
    min={0}
    max={2048}
    marginBottom={true}
    bind:value={
      () => preset.maxResponse,
      (value) => {
        const previous = currentTranslatorPresetStateSnapshot()
        const presetId = selectedTranslatorPresetId()
        preset.maxResponse = value
        syncCurrentTranslatorPreset()
        if (presetId) queueTranslatorPresetUpdate(presetId, { maxResponse: value }, previous)
      }
    }
  />
  <span class="text-textcolor mt-4"
    >{language.translatorPrompt} <Help key="translatorPrompt" /></span
  >
  <TextAreaInput
    bind:value={
      () => preset.prompt,
      (value) => {
        const previous = currentTranslatorPresetStateSnapshot()
        const presetId = selectedTranslatorPresetId()
        preset.prompt = value
        syncCurrentTranslatorPreset()
        if (presetId) queueTranslatorPresetUpdate(presetId, { prompt: value }, previous)
      }
    }
    placeholder={defaultTranslatorPrompt}
  />
{/if}
