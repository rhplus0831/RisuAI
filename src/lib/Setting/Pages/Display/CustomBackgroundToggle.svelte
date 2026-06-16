<script lang="ts">
  import { language } from 'src/lang'
  import { saveImage } from 'src/ts/storage/database.svelte'
  import { DBState } from 'src/ts/stores.svelte'
  import { selectSingleFile } from 'src/ts/util'
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import { applyServerBackedSetting } from 'src/ts/server/settingsBridge.svelte'
  import { alertError } from 'src/ts/alert'

  function formatUploadError(error: unknown) {
    if (error instanceof Error) return error.message
    return String(error)
  }
</script>

<div class="flex items-center mt-2">
  <Check
    check={DBState.db.customBackground !== ''}
    onChange={async (check) => {
      const previousBackground = DBState.db.customBackground
      if (check) {
        try {
          applyServerBackedSetting('customBackground', '-')
          const d = await selectSingleFile(['png', 'webp', 'gif'])
          if (!d) {
            applyServerBackedSetting('customBackground', previousBackground)
            return
          }
          const img = await saveImage(d.data)
          applyServerBackedSetting('customBackground', img)
        } catch (error) {
          applyServerBackedSetting('customBackground', previousBackground)
          alertError(formatUploadError(error))
        }
      } else {
        applyServerBackedSetting('customBackground', '')
      }
    }}
    name={language.useCustomBackground} />
</div>
