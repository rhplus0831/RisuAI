<script lang="ts">
  import { language } from 'src/lang'
  import { saveImage } from 'src/ts/storage/database.svelte'
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import { selectSingleFile } from 'src/ts/util'
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import { applyServerBackedSetting } from 'src/ts/server/settingsBridge.svelte'
  import { alertError } from 'src/ts/alert'
  import { createLatestOperationGuard } from 'src/ts/server/staleStateGuards'
  import { normalizeLegacyCustomBackgroundSetting } from 'src/ts/server/customBackgroundSetting'
  import { onDestroy } from 'svelte'

  const customBackgroundOperationGuard = createLatestOperationGuard<'customBackground'>()
  let uploadPending = $state(false)

  normalizeLegacyCustomBackgroundSetting()
  onDestroy(() => {
    // Invalidate picker/upload continuations owned by this component instance.
    customBackgroundOperationGuard.issue('customBackground')
  })

  function formatUploadError(error: unknown) {
    if (error instanceof Error) return error.message
    return String(error)
  }
</script>

<div class="flex items-center mt-2">
  <Check
    check={uploadPending || getDatabase().customBackground !== ''}
    onChange={async (check) => {
      const token = customBackgroundOperationGuard.issue('customBackground')
      const previousBackground = getDatabase().customBackground
      const isCurrentUpload = () =>
        customBackgroundOperationGuard.isLatest(token) && getDatabase().customBackground === previousBackground

      try {
        if (!check) {
          uploadPending = false
          if (getDatabase().customBackground !== '') {
            applyServerBackedSetting('customBackground', '')
          }
          return
        }

        uploadPending = true
        const d = await selectSingleFile(['png', 'webp', 'gif'])
        if (!isCurrentUpload()) return
        if (!d) return

        const img = await saveImage(d.data)
        if (!isCurrentUpload()) return
        applyServerBackedSetting('customBackground', img)
      } catch (error) {
        if (!isCurrentUpload()) return
        alertError(formatUploadError(error))
      } finally {
        if (customBackgroundOperationGuard.isLatest(token)) {
          uploadPending = false
        }
        customBackgroundOperationGuard.clear(token)
      }
    }}
    name={language.useCustomBackground} />
</div>
