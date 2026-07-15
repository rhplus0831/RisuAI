<script lang="ts">
  import { BookIcon, FlagIcon, ImageIcon, PaperclipIcon, SmileIcon, TrashIcon, XIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import { alertConfirm, alertError, alertInput, alertNormal } from 'src/ts/alert'
  import { authenticatedHubFetch, hubURL, type hubType, downloadRisuHub, getRealmInfo } from 'src/ts/characterCards'

  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import RealmLicense from './RealmLicense.svelte'
  import MultiLangDisplay from '../GUI/MultiLangDisplay.svelte'
  import { tooltip } from 'src/ts/gui/tooltip'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'

  interface Props {
    openedData: hubType
  }

  let { openedData = $bindable() }: Props = $props()

  function closePopup(): void {
    openedData = null
  }

  function handlePopupKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closePopup()
  }

  function realmActionFailureMessage(response: Response, body: string): string {
    const detail = body.trim()
    const prefix = `${language.errors.httpError} HTTP ${response.status}`
    return detail.length > 0 ? `${prefix}: ${detail}` : prefix
  }

  async function presentRealmActionResponse(response: Response): Promise<void> {
    const body = await response.text()
    if (!response.ok) {
      alertError(realmActionFailureMessage(response, body))
      return
    }
    alertNormal(body)
  }

  async function reportCharacter(event: MouseEvent): Promise<void> {
    event.stopPropagation()
    const targetId = openedData.id
    if (!(await alertConfirm(language.realm.reportConfirm))) return

    const report = (await alertInput(language.realm.reportPrompt)).trim()
    if (report.length === 0) return

    try {
      const response = await authenticatedHubFetch(hubURL + '/hub/report', {
        method: 'POST',
        body: JSON.stringify({ id: targetId, report }),
      })
      await presentRealmActionResponse(response)
    } catch (error) {
      alertError(error)
    }
  }

  async function removeCharacter(event: MouseEvent): Promise<void> {
    event.stopPropagation()
    const targetId = openedData.id
    if (!(await alertConfirm(language.realm.removeConfirm))) return

    try {
      const response = await authenticatedHubFetch(hubURL + '/hub/remove', {
        method: 'POST',
        body: JSON.stringify({ id: targetId }),
      })
      await presentRealmActionResponse(response)
    } catch (error) {
      alertError(error)
    }
  }

  async function copyCharacterLink(event: MouseEvent): Promise<void> {
    event.stopPropagation()
    const targetId = openedData.id
    try {
      await navigator.clipboard.writeText(`https://realm.risuai.net/character/${targetId}`)
      alertNormal(language.clipboardSuccess)
    } catch {
      alertError(language.realm.clipboardFailed)
    }
  }
</script>

<!-- Backdrop click is supplemental to the dialog's Close button and Escape handling. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-modal-root
  class="top-0 left-0 z-50 fixed w-full h-full bg-black/50 flex justify-center items-center text-textcolor"
  onclick={closePopup}>
  <div
    use:modalFocusTrap
    class="p-6 max-w-full bg-darkbg rounded-md flex flex-col gap-4 w-2xl overflow-y-auto max-h-full"
    role="dialog"
    aria-modal="true"
    aria-labelledby="risu-realm-character-title"
    tabindex="-1"
    onkeydown={handlePopupKeydown}
    onclick={(event) => {
      event.stopPropagation()
    }}>
    <div class="w-full flex flex-col">
      <div class="flex items-start gap-2">
        <h1
          id="risu-realm-character-title"
          class="text-2xl font-bold max-w-full grow overflow-hidden whitespace-nowrap text-ellipsis">
          {openedData.name}
        </h1>
        <button
          type="button"
          data-modal-initial-focus
          aria-label={language.close}
          class="text-textcolor2 hover:text-green-500 shrink-0"
          onclick={closePopup}>
          <XIcon />
        </button>
      </div>
      {#if openedData.authorname}
        <span class="text-borderc">{language.realm.madeBy(openedData.authorname)}</span>
      {/if}
      {#if openedData.original}
        <button
          type="button"
          class="text-blue-400 text-start"
          onclick={() => {
            const original = openedData.original
            openedData = null
            void getRealmInfo(original)
          }}>{language.realm.forked}</button>
      {/if}
      <div class="flex justify-start gap-4 mt-4">
        {#if getDatabase().hideAllImages}
          <div class="h-36 w-36 rounded-md bg-darkbutton flex items-center justify-center text-textcolor2">
            <span class="text-4xl">?</span>
          </div>
        {:else}
          <img
            class="h-36 w-36 rounded-md object-top object-cover"
            alt={openedData.name}
            src={`${hubURL}/resource/` + openedData.img} />
        {/if}
        <MultiLangDisplay value={openedData.desc} markdown={true} />
      </div>
      <RealmLicense license={openedData.license} />

      <div class="flex justify-start gap-2 mt-2">
        {#each openedData.tags as tag, i}
          <div class="text-xs p-1 text-blue-400">{tag}</div>
        {/each}
      </div>
      <div class="flex flex-wrap w-full flex-row gap-1 mt-2">
        <span class="text-textcolor2" use:tooltip={language.popularityLevelDesc}>
          {language.popularityLevel.replace('{}', openedData.download.toString())}
        </span>

        <div class="border-l-selected border-l ml-1 mr-1"></div>
        {#if openedData.hasEmotion}
          <button
            type="button"
            aria-label={language.characterHasEmotionImages}
            class="text-textcolor2 hover:text-green-500 transition-colors"
            onclick={() => {
              alertNormal(language.characterHasEmotionImages)
            }}><SmileIcon /></button>
        {/if}
        {#if openedData.hasAsset}
          <button
            type="button"
            aria-label={language.characterHasAdditionalAssets}
            class="text-textcolor2 hover:text-green-500 transition-colors"
            onclick={() => {
              alertNormal(language.characterHasAdditionalAssets)
            }}><ImageIcon /></button>
        {/if}
        {#if openedData.hasLore}
          <button
            type="button"
            aria-label={language.characterHasLorebook}
            class="text-textcolor2 hover:text-green-500 transition-colors"
            onclick={() => {
              alertNormal(language.characterHasLorebook)
            }}><BookIcon /></button>
        {/if}
      </div>
    </div>

    <div class="flex flex-row-reverse gap-2">
      <button
        type="button"
        aria-label={language.realm.reportCharacter}
        class="text-textcolor2 hover:text-red-500"
        onclick={reportCharacter}>
        <FlagIcon />
      </button>
      {#if openedData.creator && getDatabase().account?.id === openedData.creator}
        <button
          type="button"
          aria-label={language.realm.removeCharacter}
          class="text-textcolor2 hover:text-red-500"
          onclick={removeCharacter}>
          <TrashIcon />
        </button>
      {/if}
      <button
        type="button"
        aria-label={language.realm.copyLink}
        class="text-textcolor2 hover:text-green-500"
        onclick={copyCharacterLink}>
        <PaperclipIcon />
      </button>
      <button
        type="button"
        class="bg-selected hover:ring-3 grow p-2 font-bold rounded-md mr-2"
        onclick={() => {
          downloadRisuHub(openedData.id)
          closePopup()
        }}>
        {language.realm.chat}
      </button>
    </div>
  </div>
</div>
