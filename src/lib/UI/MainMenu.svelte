<script lang="ts">
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import Hub from './Realm/RealmMain.svelte'
  import { OpenRealmStore } from 'src/ts/stores.svelte'
  import { ArrowLeft, FolderCodeIcon } from '@lucide/svelte'
  import { getVersionString, openURL } from 'src/ts/globalApi.svelte'
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
      <div class="mt-4 mb-4 w-full border-t border-t-selected"></div>
      <div class="flex w-full max-w-md p-2">
        <button
          class="group relative flex min-h-[100px] w-full flex-col justify-center overflow-hidden rounded-2xl border border-borderc/10 bg-darkbg p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:border-borderc/30 hover:bg-selected/50 hover:shadow-xl hover:shadow-darkbg/50"
          onclick={() => {
            openURL('https://github.com/kwaroran/RisuAI')
          }}>
          <div class="relative z-10 w-[68%] sm:w-[70%]">
            <h2 class="text-2xl font-bold tracking-tight text-textcolor">GitHub</h2>
            <span class="mt-2 block text-base leading-relaxed text-textcolor2">
              Upstream project this variant is derived from.
            </span>
          </div>

          <div
            aria-hidden="true"
            class="pointer-events-none absolute -right-12 top-1/2 -translate-y-1/2 text-textcolor">
            <FolderCodeIcon
              class="h-40 w-40 md:h-44 md:w-44 origin-right -rotate-12 opacity-[0.12] transition-all duration-500 group-hover:scale-105 group-hover:opacity-[0.22]"
              strokeWidth={1} />
          </div>
        </button>
      </div>
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
