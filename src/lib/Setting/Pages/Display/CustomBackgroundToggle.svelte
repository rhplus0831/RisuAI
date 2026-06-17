<script lang="ts">
  import { language } from 'src/lang'
  import { saveImage } from 'src/ts/storage/database.svelte'
  import { DBState } from 'src/ts/stores.svelte'
  import { selectSingleFile } from 'src/ts/util'
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import { applyServerBackedSetting } from 'src/ts/server/settingsBridge.svelte'
  import { alertError } from 'src/ts/alert'
  import { createLatestOperationGuard } from 'src/ts/server/staleStateGuards'

  const customBackgroundOperationGuard = createLatestOperationGuard<'customBackground'>()

  function formatUploadError(error: unknown) {
    if (error instanceof Error) return error.message
    return String(error)
  }
</script>

<div class="flex items-center mt-2">
  <Check
    check={DBState.db.customBackground !== ''}
    onChange={async (check) => {
      const token = customBackgroundOperationGuard.issue('customBackground')
      const previousBackground = DBState.db.customBackground
      const isCurrentUpload = () =>
        customBackgroundOperationGuard.isLatest(token) && DBState.db.customBackground === '-'

      try {
        if (!check) {
          applyServerBackedSetting('customBackground', '')
          return
        }

        applyServerBackedSetting('customBackground', '-')
        const d = await selectSingleFile(['png', 'webp', 'gif'])
        if (!isCurrentUpload()) return
        if (!d) {
          applyServerBackedSetting('customBackground', previousBackground)
          return
        }

        const img = await saveImage(d.data)
        if (!isCurrentUpload()) return
        applyServerBackedSetting('customBackground', img)
      } catch (error) {
        if (!isCurrentUpload()) return
        applyServerBackedSetting('customBackground', previousBackground)
        alertError(formatUploadError(error))
      } finally {
        customBackgroundOperationGuard.clear(token)
      }
    }}
    name={language.useCustomBackground} />
</div>
