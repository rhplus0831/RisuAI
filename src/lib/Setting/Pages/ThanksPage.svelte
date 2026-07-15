<script lang="ts">
  import { language } from 'src/lang'
  import { openURL } from 'src/ts/globalApi.svelte'
  import { loadSupporters } from './supporters'

  const supportersPromise = loadSupporters()
</script>

<h2 class="text-2xl font-bold mt-2">{language.supporterThanks}</h2>
<span class="mb-2 text-textcolor2">{language.supporterThanksDesc}</span>

<div class="flex items-center justify-center rounded-md flex-wrap gap-2">
  <button
    type="button"
    aria-label={`${language.supporterThanks}: Patreon`}
    class="h-12 w-44"
    onclick={() => {
      openURL('https://www.patreon.com/RisuAI')
    }}>
    <img src="https://c5.patreon.com/external/logo/become_a_patron_button.png" alt="" class="w-full h-full" />
  </button>
  <button
    type="button"
    class="h-12 w-44 bg-slate-700 font-bold text-sm"
    onclick={() => {
      openURL('https://sv.risuai.xyz/patreon')
    }}>
    ADD YOUR NAME
  </button>
</div>

<!-- Supporters -->

{#await supportersPromise}
  <span>Loading...</span>
{:then supporter}
  <h3 class="text-xl font-bold mt-4">Supporter V</h3>
  <div class="flex w-full max-w-full flex-wrap gap-2">
    {#each supporter.V as support, index (`V-${index}-${support}`)}
      <div class="supporter-chip flex flex-col items-center justify-center border-selected border rounded-sm">
        <div class="flex justify-center items-center py-4 px-8">
          <span class="font-black prism-font prism-font-gold text-3xl">{support}</span>
        </div>
      </div>
    {/each}
  </div>
  <h3 class="text-xl font-bold mt-4">Supporter IV</h3>
  <div class="flex w-full max-w-3xl flex-wrap gap-2">
    {#each supporter.IV as support, index (`IV-${index}-${support}`)}
      <div class="supporter-chip flex flex-col items-center justify-center border-selected border rounded-sm">
        <div class="flex justify-center items-center py-4 px-8">
          <span class="font-black prism-font prism-font-silver text-2xl">{support}</span>
        </div>
      </div>
    {/each}
  </div>
  <h3 class="text-xl font-bold mt-4">Supporter III</h3>
  <div class="flex w-full max-w-3xl flex-wrap gap-2">
    {#each supporter.III as support, index (`III-${index}-${support}`)}
      <div class="supporter-chip flex flex-col items-center justify-center border-selected border rounded-sm">
        <div class="w-32 flex justify-center items-center py-3 px-6">
          <span class="font-black prism-font prism-font-silver text-xl">{support}</span>
        </div>
      </div>
    {/each}
  </div>
  <h3 class="text-xl font-bold mt-4">Supporter II</h3>
  <div class="flex w-full max-w-3xl flex-wrap gap-2">
    {#each supporter.II as support, index (`II-${index}-${support}`)}
      <div class="supporter-chip flex flex-col items-center justify-center border-selected border rounded-sm">
        <div class="w-32 flex justify-center items-center p-1">
          <span class="font-bold prism-font prism-font-copper text-lg">{support}</span>
        </div>
      </div>
    {/each}
  </div>
  <h3 class="text-xl font-bold mt-4">Supporter I</h3>
  <div class="flex w-full max-w-3xl flex-wrap gap-2">
    {#each supporter.I as support, index (`I-${index}-${support}`)}
      <div class="supporter-chip flex flex-col items-center justify-center border-selected border rounded-sm">
        <div class="w-32 flex justify-center items-center p-1">
          <span class="font-bold prism-font prism-font-copper">{support}</span>
        </div>
      </div>
    {/each}
  </div>
{:catch error}
  <span>{error instanceof Error ? error.message : 'Failed to load supporters'}</span>
{/await}

<style>
  .supporter-chip {
    contain: layout paint;
    content-visibility: auto;
    contain-intrinsic-size: 48px 128px;
  }

  .prism-font-silver {
    background: linear-gradient(to right, #777, #fff, #777, #fff, #777);
  }
  .prism-font-gold {
    background: linear-gradient(to right, #d4af32, #fff, #d4af32, #fff, #d4af32);
  }
  .prism-font-copper {
    background: linear-gradient(to right, #b87333, #fff, #b87333, #fff, #b87333);
  }

  .prism-font {
    display: inline-block;
    max-width: 100%;
    text-align: center;
    color: transparent;
    overflow-wrap: anywhere;
    background-size: 100% 100%;
    background-clip: text;
    -webkit-background-clip: text;
    background-repeat: no-repeat;
    background-position: 0 0;
    background-color: #222;
  }
</style>
