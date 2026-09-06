<script lang="ts">
  import { language } from 'src/lang'
  import {
    pushNotificationWarningDismissed,
    setPushNotificationWarningDismissed,
  } from 'src/ts/gui/pushNotificationWarningPreference'
  import {
    isRetryablePushNotificationFailure,
    retryChatCompletionPushNotificationSetup,
  } from 'src/ts/server/pushNotificationSetting'
  import {
    pushNotificationCoordinatorState,
    type PushNotificationEnableFailure,
  } from 'src/ts/server/pushNotificationState'

  let { banner = false }: { banner?: boolean } = $props()
  let state = $derived($pushNotificationCoordinatorState)

  function failureMessage(failure: PushNotificationEnableFailure): string {
    if (failure.status === 'permission-denied') return language.permissionDenied
    switch (failure.reason) {
      case 'notification-unavailable':
        return language.pushNotifications.setupFailures.notificationUnavailable
      case 'permission-default':
        return language.pushNotifications.setupFailures.permissionDefault
      case 'service-worker-unavailable':
      case 'service-worker-failed':
        return language.pushNotifications.setupFailures.serviceWorkerUnavailable
      case 'push-unavailable':
        return language.pushNotifications.setupFailures.pushUnavailable
      case 'vapid-unavailable':
        return language.pushNotifications.setupFailures.vapidUnavailable
      case 'subscription-failed':
        return language.pushNotifications.setupFailures.subscriptionFailed
      case 'server-registration-failed':
        return language.pushNotifications.setupFailures.serverRegistrationFailed
    }
  }
</script>

{#if (!banner || !$pushNotificationWarningDismissed) && state.desiredEnabled && (state.setupFailure || state.operationError)}
  <div
    class={banner
      ? 'pointer-events-auto w-full rounded-md border border-yellow-600 bg-bgcolor px-4 py-3 text-sm text-textcolor shadow-lg'
      : 'mt-2 rounded-md border border-yellow-600 p-3 text-sm text-textcolor'}
    role="status"
    aria-live="polite"
    data-push-notification-warning>
    <p class="font-semibold">{language.pushNotifications.needsAttention}</p>
    <p>
      {state.setupFailure ? failureMessage(state.setupFailure) : language.pushNotifications.setupFailures.unexpected}
    </p>
    <p>{language.pushNotifications.preferenceEnabled}</p>
    {#if state.setupFailure?.status === 'permission-denied'}
      <p>{language.pushNotifications.permissionBlockedHelp}</p>
    {:else if state.operationError || (state.setupFailure && isRetryablePushNotificationFailure(state.setupFailure))}
      <p>{language.pushNotifications.automaticRetry}</p>
    {/if}
    <div class="mt-2 flex flex-wrap gap-2">
      <button
        type="button"
        class="rounded bg-yellow-700 px-3 py-1.5 text-white disabled:cursor-wait disabled:opacity-60"
        disabled={state.phase !== 'idle'}
        onclick={(event) => {
          event.stopPropagation()
          void retryChatCompletionPushNotificationSetup()
        }}>
        {state.phase === 'idle' ? language.pushNotifications.retrySetup : language.pushNotifications.retryingSetup}
      </button>
      {#if banner}
        <button
          type="button"
          class="rounded border border-darkborderc bg-darkbutton px-3 py-1.5 text-textcolor"
          onclick={(event) => {
            event.stopPropagation()
            setPushNotificationWarningDismissed(true)
          }}>
          {language.pushNotifications.hideBannerForBrowser}
        </button>
      {/if}
    </div>
  </div>
{/if}
