<script lang="ts">
  import { ArrowLeft } from '@lucide/svelte'
  import { language } from 'src/lang'
  import { PlaygroundStore, SizeStore } from 'src/ts/stores.svelte'
  import { navigate } from 'src/ts/router'
  import { prefetchRouteIntent } from 'src/ts/routeIntentPrefetch'
  import {
    loadPlaygroundDocs,
    loadPlaygroundEmbedding,
    loadPlaygroundImageGen,
    loadPlaygroundImageTrans,
    loadPlaygroundInlayExplorer,
    loadPlaygroundJinja,
    loadPlaygroundMcp,
    loadPlaygroundParser,
    loadPlaygroundSubtitle,
    loadPlaygroundSyntax,
    loadPlaygroundTokenizer,
    loadPlaygroundTranslation,
    loadToolConversion,
  } from 'src/ts/routeComponentPreload'
  import LazyComponent from '../UI/LazyComponent.svelte'

  function preloadPlaygroundRouteFromEvent(event: Event): void {
    if (!(event.target instanceof Element)) return
    const target = event.target.closest<HTMLElement>('[data-risu-route-intent]')
    const path = target?.dataset.risuRouteIntent
    if (path) prefetchRouteIntent(path)
  }

  let easterEggTouch = $state(0)
</script>

<div class="h-full w-full flex flex-col overflow-y-auto items-center">
  {#if $PlaygroundStore === 1}
    <h2 class="text-4xl text-textcolor my-6 font-black relative">
      {language.playground.playground}
    </h2>
    <div
      class="grid grid-cols-1 gap-4 md:grid-cols-2 w-full max-w-4xl p-2"
      role="group"
      aria-label={language.playground.playground}
      onpointerover={preloadPlaygroundRouteFromEvent}
      onfocusin={preloadPlaygroundRouteFromEvent}>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1 md:col-span-2"
        data-risu-route-intent="/playground/chat"
        onclick={() => {
          navigate('/playground/chat')
        }}>
        <h1 class="text-2xl font-bold text-start">{language.Chat}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        data-risu-route-intent="/playground/cbs"
        onclick={() => {
          navigate('/playground/cbs')
        }}>
        <h1 class="text-2xl font-bold text-start">CBS Doc</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        data-risu-route-intent="/playground/embedding"
        onclick={() => {
          navigate('/playground/embedding')
        }}>
        <h1 class="text-2xl font-bold text-start">{language.embedding}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        data-risu-route-intent="/playground/tokenizer"
        onclick={() => {
          navigate('/playground/tokenizer')
        }}>
        <h1 class="text-2xl font-bold text-start">{language.tokenizer}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        data-risu-route-intent="/playground/syntax"
        onclick={() => {
          navigate('/playground/syntax')
        }}>
        <h1 class="text-2xl font-bold text-start">{language.syntax}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        data-risu-route-intent="/playground/jinja"
        onclick={() => {
          navigate('/playground/jinja')
        }}>
        <h1 class="text-2xl font-bold text-start">Jinja</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        data-risu-route-intent="/playground/image-gen"
        onclick={() => {
          navigate('/playground/image-gen')
        }}>
        <h1 class="text-2xl font-bold text-start">{language.imageGeneration}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        data-risu-route-intent="/playground/parser"
        onclick={() => {
          navigate('/playground/parser')
        }}>
        <h1 class="text-2xl font-bold text-start">Parser</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        data-risu-route-intent="/playground/subtitles"
        onclick={() => {
          navigate('/playground/subtitles')
        }}>
        <h1 class="text-2xl font-bold text-start">{language.subtitles}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        data-risu-route-intent="/playground/image-trans"
        onclick={() => {
          navigate('/playground/image-trans')
        }}>
        <h1 class="text-2xl font-bold text-start">{language.imageTranslation}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        data-risu-route-intent="/playground/translation"
        onclick={() => {
          navigate('/playground/translation')
        }}>
        <h1 class="text-2xl font-bold text-start">{language.translator}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        data-risu-route-intent="/playground/mcp"
        onclick={() => {
          navigate('/playground/mcp')
        }}>
        <h1 class="text-2xl font-bold text-start">MCP</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        data-risu-route-intent="/inlay"
        onclick={() => {
          navigate('/inlay')
        }}>
        <h1 class="text-2xl font-bold text-start">{language.playground.inlayExplorer}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        data-risu-route-intent="/playground/tools"
        onclick={() => {
          navigate('/playground/tools')
        }}>
        <h1 class="text-2xl font-bold text-start">{language.promptConvertion}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        onclick={() => {
          easterEggTouch += 1
        }}>
        <h1 class="text-2xl font-bold text-start">
          {#if easterEggTouch <= 10}
            🤗 Coming soon
          {:else if easterEggTouch <= 30}
            🤗 Still coming soon
          {:else if easterEggTouch <= 50}
            😇 Really soon
          {/if}
        </h1>
      </button>
    </div>
  {:else}
    {#if $SizeStore.w < 1024}
      <div class="mt-14"></div>
    {/if}
    <div class="w-full max-w-4xl flex flex-col p-2">
      <div class="flex items-center mt-4">
        <button
          class="mr-2 text-textcolor2 hover:text-green-500"
          aria-label={language.goback}
          onclick={() => navigate('/playground')}>
          <ArrowLeft aria-hidden="true" />
        </button>
      </div>

      {#if $PlaygroundStore === 2}
        <!-- The synthetic Playground character renders through the normal chat shell. -->
      {/if}
      {#if $PlaygroundStore === 3}
        <LazyComponent loader={loadPlaygroundEmbedding} testId="playground-embedding" />
      {/if}
      {#if $PlaygroundStore === 4}
        <LazyComponent loader={loadPlaygroundTokenizer} testId="playground-tokenizer" />
      {/if}
      {#if $PlaygroundStore === 5}
        <LazyComponent loader={loadPlaygroundSyntax} testId="playground-syntax" />
      {/if}
      {#if $PlaygroundStore === 6}
        <LazyComponent loader={loadPlaygroundJinja} testId="playground-jinja" />
      {/if}
      {#if $PlaygroundStore === 7}
        <LazyComponent loader={loadPlaygroundImageGen} testId="playground-image-gen" />
      {/if}
      {#if $PlaygroundStore === 8}
        <LazyComponent loader={loadPlaygroundParser} testId="playground-parser" />
      {/if}
      {#if $PlaygroundStore === 9}
        <LazyComponent loader={loadPlaygroundSubtitle} testId="playground-subtitles" />
      {/if}
      {#if $PlaygroundStore === 10}
        <LazyComponent loader={loadPlaygroundImageTrans} testId="playground-image-translation" />
      {/if}
      {#if $PlaygroundStore === 11}
        <LazyComponent loader={loadPlaygroundTranslation} testId="playground-translation" />
      {/if}
      {#if $PlaygroundStore === 12}
        <LazyComponent loader={loadPlaygroundMcp} testId="playground-mcp" />
      {/if}
      {#if $PlaygroundStore === 13}
        <LazyComponent loader={loadPlaygroundDocs} testId="playground-docs" />
      {/if}
      {#if $PlaygroundStore === 14}
        <LazyComponent loader={loadPlaygroundInlayExplorer} testId="playground-inlays" />
      {/if}
      {#if $PlaygroundStore === 101}
        <LazyComponent loader={loadToolConversion} testId="playground-tools" />
      {/if}
    </div>
  {/if}
</div>
