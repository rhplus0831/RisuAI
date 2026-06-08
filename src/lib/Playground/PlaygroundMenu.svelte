<script lang="ts">
  import { ArrowLeft } from '@lucide/svelte'
  import { language } from 'src/lang'
  import { PlaygroundStore, SizeStore } from 'src/ts/stores.svelte'
  import PlaygroundEmbedding from './PlaygroundEmbedding.svelte'
  import PlaygroundTokenizer from './PlaygroundTokenizer.svelte'
  import PlaygroundJinja from './PlaygroundJinja.svelte'
  import PlaygroundSyntax from './PlaygroundSyntax.svelte'
  import PlaygroundImageGen from './PlaygroundImageGen.svelte'
  import PlaygroundParser from './PlaygroundParser.svelte'
  import ToolConversion from './ToolConversion.svelte'
  import PlaygroundSubtitle from './PlaygroundSubtitle.svelte'
  import PlaygroundImageTrans from './PlaygroundImageTrans.svelte'
  import PlaygroundTranslation from './PlaygroundTranslation.svelte'
  import PlaygroundMcp from './PlaygroundMCP.svelte'
  import PlaygroundDocs from './PlaygroundDocs.svelte'
  import PlaygroundInlayExplorer from './PlaygroundInlayExplorer.svelte'
  import { navigate } from 'src/ts/router'

  let easterEggTouch = $state(0)
</script>

<div class="h-full w-full flex flex-col overflow-y-auto items-center">
  {#if $PlaygroundStore === 1}
    <h2 class="text-4xl text-textcolor my-6 font-black relative">
      {language.playground.playground}
    </h2>
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 w-full max-w-4xl p-2">
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1 md:col-span-2"
        onclick={() => {
          navigate('/playground/chat')
        }}
      >
        <h1 class="text-2xl font-bold text-start">{language.Chat}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        onclick={() => {
          navigate('/playground/cbs')
        }}
      >
        <h1 class="text-2xl font-bold text-start">CBS Doc</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        onclick={() => {
          navigate('/playground/embedding')
        }}
      >
        <h1 class="text-2xl font-bold text-start">{language.embedding}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        onclick={() => {
          navigate('/playground/tokenizer')
        }}
      >
        <h1 class="text-2xl font-bold text-start">{language.tokenizer}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        onclick={() => {
          navigate('/playground/syntax')
        }}
      >
        <h1 class="text-2xl font-bold text-start">{language.syntax}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        onclick={() => {
          navigate('/playground/jinja')
        }}
      >
        <h1 class="text-2xl font-bold text-start">Jinja</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        onclick={() => {
          navigate('/playground/image-gen')
        }}
      >
        <h1 class="text-2xl font-bold text-start">{language.imageGeneration}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        onclick={() => {
          navigate('/playground/parser')
        }}
      >
        <h1 class="text-2xl font-bold text-start">Parser</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        onclick={() => {
          navigate('/playground/subtitles')
        }}
      >
        <h1 class="text-2xl font-bold text-start">{language.subtitles}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        onclick={() => {
          navigate('/playground/image-trans')
        }}
      >
        <h1 class="text-2xl font-bold text-start">{language.imageTranslation}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        onclick={() => {
          navigate('/playground/translation')
        }}
      >
        <h1 class="text-2xl font-bold text-start">{language.translator}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        onclick={() => {
          navigate('/playground/mcp')
        }}
      >
        <h1 class="text-2xl font-bold text-start">MCP</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        onclick={() => {
          navigate('/inlay')
        }}
      >
        <h1 class="text-2xl font-bold text-start">{language.playground.inlayExplorer}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        onclick={() => {
          navigate('/playground/tools')
        }}
      >
        <h1 class="text-2xl font-bold text-start">{language.promptConvertion}</h1>
      </button>
      <button
        class="bg-darkbg rounded-md p-6 flex flex-col transition-shadow hover:ring-1"
        onclick={() => {
          easterEggTouch += 1
        }}
      >
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
          onclick={() => navigate('/playground')}
        >
          <ArrowLeft />
        </button>
      </div>

      {#if $PlaygroundStore === 2}
        <!-- Reserved for Playground chat. -->
      {/if}
      {#if $PlaygroundStore === 3}
        <PlaygroundEmbedding />
      {/if}
      {#if $PlaygroundStore === 4}
        <PlaygroundTokenizer />
      {/if}
      {#if $PlaygroundStore === 5}
        <PlaygroundSyntax />
      {/if}
      {#if $PlaygroundStore === 6}
        <PlaygroundJinja />
      {/if}
      {#if $PlaygroundStore === 7}
        <PlaygroundImageGen />
      {/if}
      {#if $PlaygroundStore === 8}
        <PlaygroundParser />
      {/if}
      {#if $PlaygroundStore === 9}
        <PlaygroundSubtitle />
      {/if}
      {#if $PlaygroundStore === 10}
        <PlaygroundImageTrans />
      {/if}
      {#if $PlaygroundStore === 11}
        <PlaygroundTranslation />
      {/if}
      {#if $PlaygroundStore === 12}
        <PlaygroundMcp />
      {/if}
      {#if $PlaygroundStore === 13}
        <PlaygroundDocs />
      {/if}
      {#if $PlaygroundStore === 14}
        <PlaygroundInlayExplorer />
      {/if}
      {#if $PlaygroundStore === 101}
        <ToolConversion />
      {/if}
    </div>
  {/if}
</div>
