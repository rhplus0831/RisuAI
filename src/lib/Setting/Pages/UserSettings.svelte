<script lang="ts">
  import { language } from 'src/lang'

  import { alertConfirm } from 'src/ts/alert'
  import { loadInternalBackup } from 'src/ts/globalApi.svelte'
  import { SaveServerBackup, loadBackupFromDevice, saveBackupToDevice } from 'src/ts/storage/backup'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import { exportAsDataset } from 'src/ts/storage/exportAsDataset'
  import { cleanColdStorage } from 'src/ts/process/coldstorage.svelte'
</script>

<h2 class="mb-2 text-2xl font-bold mt-2">{language.account} & {language.files}</h2>

<Button
  onclick={async () => {
    if (await alertConfirm(language.backupConfirm)) {
      SaveServerBackup()
    }
  }}
  className="mt-2"
>
  Save Server Backup
</Button>

<Button
  onclick={async () => {
    if (
      (await alertConfirm(language.backupLoadConfirm)) &&
      (await alertConfirm(language.backupLoadConfirm2))
    ) {
      loadInternalBackup()
    }
  }}
  className="mt-2"
>
  Load Server Backup
</Button>

<Button
  onclick={async () => {
    if (await alertConfirm(language.backupConfirm)) {
      saveBackupToDevice()
    }
  }}
  className="mt-2"
>
  {language.saveBackupLocal}
</Button>

<Button
  onclick={async () => {
    if (
      (await alertConfirm(language.backupLoadConfirm)) &&
      (await alertConfirm(language.backupLoadConfirm2))
    ) {
      loadBackupFromDevice()
    }
  }}
  className="mt-2"
>
  {language.loadBackupLocal}
</Button>

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
