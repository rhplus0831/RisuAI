<script module lang="ts">
  import { language as moduleLanguage } from 'src/lang'
  import { alertError as alertModuleError } from 'src/ts/alert'
  import { getDatabase as getModuleDatabase } from 'src/ts/storage/database.svelte'
  import { applyServerBackedSetting as applyModuleSetting } from 'src/ts/server/settingsBridge.svelte'
  import {
    disableChatCompletionPushNotifications,
    enableChatCompletionPushNotifications,
  } from 'src/ts/server/pushNotifications'
  import { createNotificationToggleReconciler } from './notificationToggleReconciler'

  const notificationToggleReconciler = createNotificationToggleReconciler(async (enabled) => {
    if (!enabled) {
      await disableChatCompletionPushNotifications()
      return
    }

    const pushResult = await enableChatCompletionPushNotifications()
    if (pushResult.status === 'permission-denied' && getModuleDatabase().notification) {
      alertModuleError(moduleLanguage.permissionDenied)
      applyModuleSetting('notification', false)
    }
  })
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
      void notificationToggleReconciler.reconcile(nextValue)
    }} />
</div>
