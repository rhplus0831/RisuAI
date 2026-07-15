<script lang="ts">
  import { downloadRisuHub, getRisuHub, type hubType, type RisuHubCatalogResult } from 'src/ts/characterCards'
  import { ArrowLeft, ArrowRight, MenuIcon, SearchIcon, XIcon } from '@lucide/svelte'
  import { onDestroy } from 'svelte'
  import { alertError, alertInput } from 'src/ts/alert'
  import { language } from 'src/lang'
  import RisuHubIcon from './RealmHubIcon.svelte'
  import { MobileGUI, RealmInitialOpenChar } from 'src/ts/stores.svelte'
  import RealmPopUp from './RealmPopUp.svelte'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'
  import { resolveRealmImportId } from './realmImportInput'

  let openedData: null | hubType = $state(null)

  let charas: hubType[] = $state([])
  let additionalHTML = $state('')

  let page = $state(0)
  let sort = $state('recommended')

  let search = $state('')
  let menuOpen = $state(false)
  let nsfw = $state(false)
  let latestHubRequest = 0
  let hubRequestController: AbortController | null = null
  let hubLifecycleActive = true

  async function getHub() {
    const request = ++latestHubRequest
    hubRequestController?.abort()
    const controller = new AbortController()
    hubRequestController = controller
    const nextCatalog = await getRisuHub({
      search: search,
      page: page,
      nsfw: nsfw,
      sort: sort,
      signal: controller.signal,
    })
    if (!hubLifecycleActive || controller.signal.aborted || request !== latestHubRequest) return
    applyCatalogPresentation(nextCatalog)
    if (hubRequestController === controller) {
      hubRequestController = null
    }
  }

  function applyCatalogPresentation(nextCatalog: RisuHubCatalogResult): void {
    charas = nextCatalog.cards
    additionalHTML = nextCatalog.additionalHTML
  }

  function refreshHubFromFirstPage(): Promise<void> {
    page = 0
    return getHub()
  }

  function changeSort(type: string) {
    if (sort === type) {
      sort = 'recommended'
    } else {
      sort = type
    }
    return refreshHubFromFirstPage()
  }

  function closeMenu(): void {
    menuOpen = false
  }

  function handleMenuKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closeMenu()
  }

  async function importCharacterFromInput(): Promise<void> {
    closeMenu()
    const input = await alertInput(language.realm.importPrompt)
    if (input.trim().length === 0) return

    const id = resolveRealmImportId(input)
    if (!id) {
      alertError(language.realm.invalidImport)
      return
    }
    void downloadRisuHub(id)
  }

  getHub()

  onDestroy(() => {
    hubLifecycleActive = false
    latestHubRequest += 1
    hubRequestController?.abort()
    hubRequestController = null
  })

  $effect(() => {
    if ($RealmInitialOpenChar) {
      openedData = $RealmInitialOpenChar
      $RealmInitialOpenChar = null
    }
  })
</script>

<div class="w-full flex justify-center mt-4 mb-2">
  <div class="flex items-stretch w-2xl max-w-full">
    <input
      bind:value={search}
      aria-label={language.realm.searchCharacters}
      class="peer focus:border-textcolor transition-colors outline-hidden text-textcolor p-2 min-w-0 border border-r-0 bg-transparent rounded-md rounded-r-none input-text text-xl grow ml-4 border-darkborderc resize-none overflow-y-hidden overflow-x-hidden max-w-full" />
    <button
      type="button"
      aria-label={language.search}
      onclick={() => {
        if (sort === 'random' || sort === 'recommended') {
          sort = ''
        }
        refreshHubFromFirstPage()
      }}
      class="flex justify-center border-y border-darkborderc items-center text-textcolor p-3 peer-focus:border-textcolor hover:bg-blue-500 hover:text-white transition-colors">
      <SearchIcon />
    </button>
    <button
      type="button"
      aria-label={language.menu}
      onclick={() => {
        menuOpen = true
      }}
      class="peer-focus:border-textcolor mr-2 flex border-y border-r border-darkborderc justify-center items-center text-textcolor p-3 rounded-r-md hover:bg-blue-500 hover:text-white transition-colors">
      <MenuIcon />
    </button>
  </div>
</div>
{#if $MobileGUI}
  <div class="ml-4 flex items-start">
    <div class="p-2 flex mb-3 overflow-x-auto rounded-lg border-darkborderc border gap-2">
      <button
        onclick={() => {
          nsfw = !nsfw
          refreshHubFromFirstPage()
        }}>
        {nsfw ? 'NSFW' : 'SFW'}
      </button>
      <div class="h-full border-r border-r-selected"></div>
      <button
        onclick={() => {
          switch (sort) {
            case '':
              sort = 'trending'
              break
            case 'trending':
              sort = 'downloads'
              break
            case 'downloads':
              sort = 'random'
              break
            default:
              sort = ''
              break
          }
          refreshHubFromFirstPage()
        }}>
        {sort === 'recommended'
          ? language.recommended
          : sort === ''
            ? language.recent
            : sort === 'trending'
              ? language.trending
              : sort === 'downloads'
                ? language.downloads
                : language.random}
      </button>
    </div>
  </div>
{:else}
  <div class="w-full p-1 flex mb-3 overflow-x-auto sm:justify-center">
    <button
      aria-pressed={nsfw}
      class="bg-darkbg p-2 rounded-lg ml-2 flex justify-center items-center hover:bg-selected transition-shadow"
      class:ring-3={nsfw}
      onclick={() => {
        nsfw = !nsfw
        refreshHubFromFirstPage()
      }}>
      NSFW
    </button>
    <div class="ml-2 mr-2 h-full border-r border-r-selected"></div>
    <button
      aria-pressed={sort === ''}
      class="bg-darkbg p-2 rounded-lg ml-2 flex justify-center items-center hover:bg-selected transition-shadow"
      class:ring-3={sort === ''}
      onclick={() => {
        changeSort('')
      }}>
      {language.recent}
    </button>
    <button
      aria-pressed={sort === 'trending'}
      class="bg-darkbg p-2 rounded-lg ml-2 flex justify-center items-center hover:bg-selected transition-shadow"
      class:ring-3={sort === 'trending'}
      onclick={() => {
        changeSort('trending')
      }}>
      {language.trending}
    </button>
    <button
      aria-pressed={sort === 'downloads'}
      class="bg-darkbg p-2 rounded-lg ml-2 flex justify-center items-center hover:bg-selected transition-shadow"
      class:ring-3={sort === 'downloads'}
      onclick={() => {
        changeSort('downloads')
      }}>
      {language.downloads}
    </button>
    <button
      aria-pressed={sort === 'random'}
      class="bg-darkbg p-2 rounded-lg ml-2 flex justify-center items-center hover:bg-selected transition-shadow min-w-0 max-w-full"
      class:ring-3={sort === 'random'}
      onclick={() => {
        changeSort('random')
      }}>
      {language.random}
    </button>
  </div>
{/if}
{@html additionalHTML}
<div class="w-full flex gap-4 p-2 flex-wrap justify-center">
  {#key charas}
    {#each charas as chara}
      <RisuHubIcon
        onClick={() => {
          openedData = chara
        }}
        {chara} />
    {/each}
  {/key}
</div>
{#if sort !== 'random' && sort !== 'recommended'}
  <div class="w-full flex justify-center">
    <div class="flex">
      <button
        type="button"
        aria-label={language.realm.previousPage}
        disabled={page === 0}
        class="bg-darkbg h-14 w-14 min-w-14 rounded-lg flex justify-center items-center hover:ring-3 transition-shadow"
        onclick={() => {
          if (page > 0) {
            page -= 1
            getHub()
          }
        }}>
        <ArrowLeft />
      </button>
      <span
        class="bg-darkbg h-14 w-14 min-w-14 rounded-lg ml-2 flex justify-center items-center transition-shadow"
        aria-current="page"
        aria-label={language.realm.currentPage(page + 1)}>
        <span>{page + 1}</span>
      </span>
      <button
        type="button"
        aria-label={language.realm.nextPage}
        class="bg-darkbg h-14 w-14 min-w-14 rounded-lg ml-2 flex justify-center items-center hover:ring-3 transition-shadow"
        onclick={() => {
          page += 1
          getHub()
        }}>
        <ArrowRight />
      </button>
    </div>
  </div>
{/if}

{#if openedData}
  <RealmPopUp bind:openedData />
{/if}

{#if menuOpen}
  <!-- Backdrop click is supplemental to the dialog's Close button and Escape handling. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    data-modal-root
    class="top-0 left-0 z-50 fixed w-full h-full bg-black/50 flex justify-center items-center"
    onclick={closeMenu}>
    <div
      use:modalFocusTrap
      class="max-w-full bg-darkbg rounded-md flex flex-col gap-4 overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="risu-realm-menu-title"
      tabindex="-1"
      onkeydown={handleMenuKeydown}
      onclick={(event) => {
        event.stopPropagation()
      }}>
      <h1 id="risu-realm-menu-title" class="font-bold text-2xl w-full">
        <span>{language.menu}</span>
        <button
          type="button"
          data-modal-initial-focus
          aria-label={language.close}
          class="float-right text-textcolor2 hover:text-green-500"
          onclick={closeMenu}>
          <XIcon />
        </button>
      </h1>
      <div class=" mt-2 w-full border-t-2 border-t-bgcolor"></div>
      <button type="button" class="w-full hover:bg-selected p-4" onclick={importCharacterFromInput}
        >{language.realm.importCharacter}</button>
    </div>
  </div>
{/if}
