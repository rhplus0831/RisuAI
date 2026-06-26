<script lang="ts">
  import { language } from 'src/lang'
  import { alertError } from 'src/ts/alert'
  import { DBState } from 'src/ts/stores.svelte'
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import { applyServerBackedSetting } from 'src/ts/server/settingsBridge.svelte'
  import {
    disableChatCompletionPushNotifications,
    enableChatCompletionPushNotifications,
  } from 'src/ts/server/pushNotifications'
</script>

<div class="flex items-center mt-2">
  <Check
    check={DBState.db.notification}
    name={language.notification}
    onChange={async (nextValue) => {
      applyServerBackedSetting('notification', nextValue)
      if (!nextValue) {
        await disableChatCompletionPushNotifications()
        return
      }

      const pushResult = await enableChatCompletionPushNotifications()
      if (pushResult.status === 'permission-denied') {
        alertError(language.permissionDenied)
        applyServerBackedSetting('notification', false)
      }
    }} />
</div>
