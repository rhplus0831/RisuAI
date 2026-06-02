<script lang="ts">
  import { DBState } from 'src/ts/stores.svelte'
  import Hub from './Realm/RealmMain.svelte'
  import { OpenRealmStore, RealmInitialOpenChar } from 'src/ts/stores.svelte'
  import { ArrowLeft, FolderCodeIcon } from '@lucide/svelte'
  import { getVersionString, openURL } from 'src/ts/globalApi.svelte'
  import { language } from 'src/lang'
  import { getRisuHub, hubAdditionalHTML } from 'src/ts/characterCards'
  import RisuHubIcon from './Realm/RealmHubIcon.svelte'
  import Title from './Title.svelte'
</script>

<div class="h-full w-full flex flex-col overflow-y-auto items-center">
  {#if !$OpenRealmStore}
    <Title />
    <h3 class="text-textcolor2 mt-1">{getVersionString()}</h3>
  {/if}
  <div class="w-full flex p-4 flex-col text-textcolor max-w-4xl">
    {#if !$OpenRealmStore}
      <div class="mt-4 mb-4 w-full border-t border-t-selected"></div>
      <h1 class="text-2xl font-bold">
        Recently Uploaded<button
          class="text-base font-medium float-right p-1 bg-darkbg rounded-md hover:ring-3"
          onclick={() => {
            $OpenRealmStore = true
          }}>Get More</button
        >
      </h1>
      {#if !DBState.db.hideRealm}
        {#await getRisuHub({ search: '', page: 0, nsfw: false, sort: 'recommended' }) then charas}
          {#if charas.length > 0}
            {@html hubAdditionalHTML}
            <div class="w-full flex gap-4 p-2 flex-wrap justify-center">
              {#each charas as chara}
                <RisuHubIcon
                  onClick={() => {
                    $OpenRealmStore = true
                    if (DBState.db.realmDirectOpen) {
                      $RealmInitialOpenChar = chara
                    }
                  }}
                  {chara}
                />
              {/each}
            </div>
          {:else}
            <div class="text-textcolor2">Failed to load {language.hub}...</div>
          {/if}
        {/await}
      {:else}
        <div class="text-textcolor2">{language.hideRealm}</div>
      {/if}
      <div class="mt-4 mb-4 w-full border-t border-t-selected"></div>
      <div class="flex w-full max-w-md p-2">
        <button
          class="group relative flex min-h-[100px] w-full flex-col justify-center overflow-hidden rounded-2xl border border-borderc/10 bg-darkbg p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:border-borderc/30 hover:bg-selected/50 hover:shadow-xl hover:shadow-darkbg/50"
          onclick={() => {
            openURL('https://github.com/kwaroran/RisuAI')
          }}
        >
          <div class="relative z-10 w-[68%] sm:w-[70%]">
            <h2 class="text-2xl font-bold tracking-tight text-textcolor">GitHub</h2>
            <span class="mt-2 block text-base leading-relaxed text-textcolor2">
              Upstream project this variant is derived from.
            </span>
          </div>

          <div
            aria-hidden="true"
            class="pointer-events-none absolute -right-12 top-1/2 -translate-y-1/2 text-textcolor"
          >
            <FolderCodeIcon
              class="h-40 w-40 md:h-44 md:w-44 origin-right -rotate-12 opacity-[0.12] transition-all duration-500 group-hover:scale-105 group-hover:opacity-[0.22]"
              strokeWidth={1}
            />
          </div>
        </button>
      </div>
    {:else}
      <div class="flex items-center mt-4">
        <button
          class="mr-2 text-textcolor2 hover:text-green-500"
          onclick={() => ($OpenRealmStore = false)}
        >
          <ArrowLeft />
        </button>
      </div>
      <Hub />
    {/if}
  </div>
</div>
