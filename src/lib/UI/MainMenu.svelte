<script lang="ts">
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import Hub from './Realm/RealmMain.svelte'
  import { OpenRealmStore } from 'src/ts/stores.svelte'
  import { ArrowLeft } from '@lucide/svelte'
  import { getVersionString } from 'src/ts/globalApi.svelte'
  import { language } from 'src/lang'
  import Title from './Title.svelte'
  import { alertConfirm } from 'src/ts/alert'

  let realmConfirmOpen = $state(false)

  async function openRealm() {
    if ($OpenRealmStore || realmConfirmOpen) return

    if (!getDatabase().doNotWarnExternalServers) {
      realmConfirmOpen = true
      try {
        if (!(await alertConfirm(language.sendExternalServerWarning))) return
      } finally {
        realmConfirmOpen = false
      }
    }

    $OpenRealmStore = true
  }
</script>

<div class="h-full w-full flex flex-col overflow-y-auto items-center">
  {#if !$OpenRealmStore}
    <Title />
    <h3 class="text-textcolor2 mt-1">{getVersionString()}</h3>
  {/if}
  <div class="w-full flex p-4 flex-col text-textcolor max-w-4xl">
    {#if !$OpenRealmStore}
      <div class="mt-4 mb-4 w-full border-t border-t-selected"></div>
      <button
        class="w-full rounded-lg bg-darkbg px-5 py-4 text-left text-xl font-bold transition-colors hover:bg-selected"
        onclick={openRealm}>
        {language.openRisuRealm}
      </button>
    {:else}
      <div class="flex items-center mt-4">
        <button
          class="mr-2 text-textcolor2 hover:text-green-500"
          aria-label={language.goback}
          onclick={() => ($OpenRealmStore = false)}>
          <ArrowLeft aria-hidden="true" />
        </button>
      </div>
      <Hub />
    {/if}
  </div>
</div>
