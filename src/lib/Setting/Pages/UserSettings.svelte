<script lang="ts">
  import { language } from 'src/lang'

  import { alertConfirm, alertError } from 'src/ts/alert'
  import { loadInternalBackup } from 'src/ts/globalApi.svelte'
  import {
    SaveServerBackup,
    loadBackupFromDevice,
    saveBackupToDevice,
    saveZipBackupToDevice,
    type BackupProgressCallback,
  } from 'src/ts/storage/backup'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import { exportAsDataset } from 'src/ts/storage/exportAsDataset'
  import { cleanColdStorage } from 'src/ts/process/coldstorage.svelte'
  import type { ServerBackupProgress } from 'src/ts/server/backups'

  type BackupProgressKind =
    | 'serverSave'
    | 'serverRestore'
    | 'localSave'
    | 'localZipSave'
    | 'localRestore'
  type OperationStatus = 'ok' | 'error' | 'unavailable' | 'cancelled'

  interface BackupProgressView {
    message: string
    percent: number | null
    detail: string
    state: 'running' | 'done' | 'error'
  }

  let activeBackupOperation = $state<BackupProgressKind | null>(null)
  let backupProgress = $state<Record<BackupProgressKind, BackupProgressView | null>>({
    serverSave: null,
    serverRestore: null,
    localSave: null,
    localZipSave: null,
    localRestore: null,
  })

  async function runBackupOperation(
    kind: BackupProgressKind,
    initialMessage: string,
    action: (onProgress: BackupProgressCallback) => Promise<OperationStatus>,
  ) {
    if (activeBackupOperation !== null) return
    activeBackupOperation = kind
    backupProgress[kind] = {
      message: initialMessage,
      percent: 0,
      detail: '',
      state: 'running',
    }

    try {
      const status = await action((progress) => setBackupProgress(kind, progress))
      finishBackupProgress(kind, status)
    } catch (err) {
      finishBackupProgress(kind, 'error')
      alertError(err)
    } finally {
      activeBackupOperation = null
    }
  }

  function setBackupProgress(kind: BackupProgressKind, progress: ServerBackupProgress) {
    backupProgress[kind] = {
      message: progress.message,
      percent: progress.percent === null ? null : Math.max(0, Math.min(100, progress.percent)),
      detail: formatProgressDetail(progress),
      state: 'running',
    }
  }

  function finishBackupProgress(kind: BackupProgressKind, status: OperationStatus) {
    if (status === 'cancelled' || status === 'unavailable') {
      backupProgress[kind] = null
      return
    }

    const current = backupProgress[kind]
    backupProgress[kind] = {
      message: status === 'ok' ? (current?.message ?? 'Backup complete') : 'Backup failed',
      percent: status === 'ok' ? 100 : (current?.percent ?? 100),
      detail: current?.detail ?? '',
      state: status === 'ok' ? 'done' : 'error',
    }
  }

  function formatProgressDetail(progress: ServerBackupProgress): string {
    if (typeof progress.loadedBytes !== 'number') return ''
    const loaded = formatBytes(progress.loadedBytes)
    if (typeof progress.totalBytes === 'number' && progress.totalBytes > 0) {
      return `${loaded} / ${formatBytes(progress.totalBytes)}`
    }
    return loaded
  }

  function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = bytes
    let unitIndex = 0
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024
      unitIndex += 1
    }
    return `${value < 10 && unitIndex > 0 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`
  }

  function progressWidth(progress: BackupProgressView): string {
    return progress.percent === null ? '100%' : `${progress.percent}%`
  }

  function progressLabel(progress: BackupProgressView): string {
    return progress.percent === null ? 'Working' : `${Math.round(progress.percent)}%`
  }
</script>

<h2 class="mb-2 text-2xl font-bold mt-2">{language.account} & {language.files}</h2>

{#snippet ProgressBar(progress: BackupProgressView)}
  <div class="mt-2 w-full max-w-xl" role="status" aria-live="polite">
    <div class="flex items-center justify-between gap-3 text-xs text-textcolor2">
      <span class="min-w-0 truncate">{progress.message}</span>
      <span class="shrink-0">{progressLabel(progress)}</span>
    </div>
    <div class="mt-1 h-2 w-full overflow-hidden rounded-md border border-darkborderc bg-darkbg">
      <div
        class="h-full bg-linear-to-r transition-[width] duration-200"
        class:from-green-500={progress.state !== 'error'}
        class:to-blue-500={progress.state !== 'error'}
        class:from-red-600={progress.state === 'error'}
        class:to-red-400={progress.state === 'error'}
        class:saving-animation={progress.state === 'running'}
        style:width={progressWidth(progress)}
      ></div>
    </div>
    {#if progress.detail}
      <div class="mt-1 text-xs text-textcolor2">{progress.detail}</div>
    {/if}
  </div>
{/snippet}

<Button
  onclick={async () => {
    if (await alertConfirm(language.backupConfirm)) {
      await runBackupOperation('serverSave', 'Creating server backup', (onProgress) =>
        SaveServerBackup({ onProgress }),
      )
    }
  }}
  className="mt-2"
  disabled={activeBackupOperation !== null}
>
  Save Server Backup
</Button>
{#if backupProgress.serverSave}
  {@render ProgressBar(backupProgress.serverSave)}
{/if}

<Button
  onclick={async () => {
    if (
      (await alertConfirm(language.backupLoadConfirm)) &&
      (await alertConfirm(language.backupLoadConfirm2))
    ) {
      await runBackupOperation('serverRestore', 'Loading server backups', (onProgress) =>
        loadInternalBackup({ onProgress }),
      )
    }
  }}
  className="mt-2"
  disabled={activeBackupOperation !== null}
>
  Load Server Backup
</Button>
{#if backupProgress.serverRestore}
  {@render ProgressBar(backupProgress.serverRestore)}
{/if}

<Button
  onclick={async () => {
    if (await alertConfirm(language.backupConfirm)) {
      await runBackupOperation('localSave', 'Saving local backup', (onProgress) =>
        saveBackupToDevice({ onProgress }),
      )
    }
  }}
  className="mt-2"
  disabled={activeBackupOperation !== null}
>
  {language.saveBackupLocal}
</Button>
{#if backupProgress.localSave}
  {@render ProgressBar(backupProgress.localSave)}
{/if}

<Button
  onclick={async () => {
    if (await alertConfirm(language.backupConfirm)) {
      await runBackupOperation('localZipSave', 'Saving ZIP-style local backup', (onProgress) =>
        saveZipBackupToDevice({ onProgress }),
      )
    }
  }}
  className="mt-2"
  disabled={activeBackupOperation !== null}
>
  {language.saveBackupLocalZipStyle}
</Button>
{#if backupProgress.localZipSave}
  {@render ProgressBar(backupProgress.localZipSave)}
{/if}

<Button
  onclick={async () => {
    if (
      (await alertConfirm(language.backupLoadConfirm)) &&
      (await alertConfirm(language.backupLoadConfirm2))
    ) {
      await runBackupOperation('localRestore', 'Waiting for local backup file', (onProgress) =>
        loadBackupFromDevice({ onProgress }),
      )
    }
  }}
  className="mt-2"
  disabled={activeBackupOperation !== null}
>
  {language.loadBackupLocal}
</Button>
{#if backupProgress.localRestore}
  {@render ProgressBar(backupProgress.localRestore)}
{/if}

<Button
  onclick={async () => {
    if (await alertConfirm(language.cleanColdStorageConfirm)) {
      cleanColdStorage()
    }
  }}
  className="mt-2"
>
  {language.cleanColdStorage}
</Button>

<Button onclick={exportAsDataset} className="mt-2">
  {language.exportAsDataset}
</Button>
