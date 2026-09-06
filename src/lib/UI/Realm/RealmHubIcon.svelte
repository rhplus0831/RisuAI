<script lang="ts">
  import { BookIcon, ImageIcon, SmileIcon } from '@lucide/svelte'
  import { alertNormal } from 'src/ts/alert'
  import { hubURL, type hubType } from 'src/ts/characterCards'
  import { settingsResourceState } from 'src/ts/server/resourceState.svelte'
  import { parseMultilangString } from 'src/ts/util'
  import { language } from 'src/lang'

  interface Props {
    onClick?: any
    chara: hubType
  }

  let { onClick = () => {}, chara }: Props = $props()
  let hideAllImages = $derived(
    settingsResourceState.groupStatuses.display === 'ready' && Boolean(settingsResourceState.value.hideAllImages),
  )
  let userLanguage = $derived(
    settingsResourceState.groupStatuses.language === 'ready' ? (settingsResourceState.value.language ?? 'en') : 'en',
  )
</script>

<div class="bg-darkbg rounded-lg p-4 hover:bg-selected transition-colors relative lg:w-96 w-full">
  <button class="flex gap-2 w-full text-left pb-7" onclick={onClick} aria-label={language.openCharacter(chara.name)}>
    {#if hideAllImages}
      <div
        class="w-20 min-w-20 h-20 sm:h-28 sm:w-28 rounded-md bg-darkbutton flex items-center justify-center text-textcolor2">
        <span class="text-4xl">?</span>
      </div>
    {:else}
      <img
        class="w-20 min-w-20 h-20 sm:h-28 sm:w-28 rounded-md object-top object-cover"
        alt={chara.name}
        src={`${hubURL}/resource/` + chara.img} />
    {/if}
    <div class="flex flex-col grow min-w-0">
      <span class="text-textcolor text-lg min-w-0 max-w-full text-ellipsis whitespace-nowrap overflow-hidden text-start"
        >{chara.name}</span>
      <span
        class="text-textcolor2 text-xs min-w-0 max-w-full text-ellipsis wrap-break-word max-h-8 whitespace-nowrap overflow-hidden text-start"
        >{parseMultilangString(chara.desc)[userLanguage] ??
          parseMultilangString(chara.desc).en ??
          parseMultilangString(chara.desc).xx}</span>
      <div class="flex flex-wrap">
        {#each chara.tags as tag, i}
          {#if i < 4}
            <div class="text-xs p-1 text-blue-400">{tag}</div>
          {:else if i === 4}
            <div class="text-xs p-1 text-blue-400">...</div>
          {/if}
        {/each}
      </div>
    </div>
  </button>
  <div class="absolute bottom-4 right-4 flex flex-row-reverse gap-1">
    {#if chara.hasEmotion}
      <button
        type="button"
        class="text-textcolor2 hover:text-green-500 transition-colors"
        aria-label={language.characterHasEmotionImages}
        onclick={() => alertNormal(language.characterHasEmotionImages)}>
        <SmileIcon />
      </button>
    {/if}
    {#if chara.hasAsset}
      <button
        type="button"
        class="text-textcolor2 hover:text-green-500 transition-colors"
        aria-label={language.characterHasAdditionalAssets}
        onclick={() => alertNormal(language.characterHasAdditionalAssets)}>
        <ImageIcon />
      </button>
    {/if}
    {#if chara.hasLore}
      <button
        type="button"
        class="text-textcolor2 hover:text-green-500 transition-colors"
        aria-label={language.characterHasLorebook}
        onclick={() => alertNormal(language.characterHasLorebook)}>
        <BookIcon />
      </button>
    {/if}
  </div>
</div>
