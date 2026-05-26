<script lang="ts">
  import { language } from 'src/lang'
  import { saveImage } from 'src/ts/storage/database.svelte'
  import { DBState } from 'src/ts/stores.svelte'
  import { selectSingleFile } from 'src/ts/util'
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import { applyServerBackedSetting } from 'src/ts/server/settingsBridge.svelte'
</script>

<div class="flex items-center mt-2">
  <Check
    check={DBState.db.customBackground !== ''}
    onChange={async (check) => {
      if (check) {
        applyServerBackedSetting('customBackground', '-')
        const d = await selectSingleFile(['png', 'webp', 'gif'])
        if (!d) {
          applyServerBackedSetting('customBackground', '')
          return
        }
        const img = await saveImage(d.data)
        applyServerBackedSetting('customBackground', img)
      } else {
        applyServerBackedSetting('customBackground', '')
      }
    }}
    name={language.useCustomBackground}
  />
</div>
