<script>
  import { ChevronDown, ChevronUp } from '@lucide/svelte'
  import { language } from '../../lang'
  import { moveDropListItem } from './dropList'

  /** @type {{list?: any}} */
  let { list = $bindable([]) } = $props()

  function moveItem(index, direction) {
    list = moveDropListItem(list, index, direction)
  }
</script>

<div class="list flex flex-col rounded-md border border-selected">
  {#each list as n, i}
    <div class="w-full h-10 flex items-center">
      <span class="ml-2 grow">{language.formating[n]}</span>
      <button class="mr-1" disabled={list.length < 2} onclick={() => moveItem(i, -1)}
        ><ChevronUp /></button
      >
      <button class="mr-1" disabled={list.length < 2} onclick={() => moveItem(i, 1)}
        ><ChevronDown /></button
      >
    </div>
    {#if i !== list.length - 1}
      <div class="border-t w-full border-selected"></div>
    {/if}
  {/each}
</div>
