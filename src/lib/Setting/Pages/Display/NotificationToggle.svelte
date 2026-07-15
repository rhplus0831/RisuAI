<script module lang="ts">
  import { language as moduleLanguage } from 'src/lang'
  import { alertError as alertModuleError } from 'src/ts/alert'
  import { getDatabase as getModuleDatabase } from 'src/ts/storage/database.svelte'
  import { applyServerBackedSetting as applyModuleSetting } from 'src/ts/server/settingsBridge.svelte'
  import { reconcileChatCompletionPushNotificationSetting } from 'src/ts/server/pushNotificationSetting'

  async function reconcileNotificationSetting(enabled: boolean): Promise<void> {
    const outcome = await reconcileChatCompletionPushNotificationSetting(enabled)
    if (
      outcome.status === 'applied' &&
      enabled &&
      outcome.result.status === 'permission-denied' &&
      getModuleDatabase().notification
    ) {
      alertModuleError(moduleLanguage.permissionDenied)
      applyModuleSetting('notification', false)
    }
  }
</script>

<script lang="ts">
  import { language } from 'src/lang'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import { applyServerBackedSetting } from 'src/ts/server/settingsBridge.svelte'
</script>

<div class="flex items-center mt-2">
  <Check
    check={getDatabase().notification}
    name={language.notification}
    onChange={(nextValue) => {
      applyServerBackedSetting('notification', nextValue)
      void reconcileNotificationSetting(nextValue)
    }} />
</div>
