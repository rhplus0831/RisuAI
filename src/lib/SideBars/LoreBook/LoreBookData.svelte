<script lang="ts">
  import {
    XIcon,
    LinkIcon,
    SunIcon,
    BookCopyIcon,
    FolderIcon,
    FolderOpen,
    PlusIcon,
  } from '@lucide/svelte'
  import { v4 } from 'uuid'
  import { language } from '../../../lang'
  import {
    getCurrentCharacter,
    getCurrentChat,
    type loreBook,
  } from '../../../ts/storage/database.svelte'
  import { alertConfirm, alertMd } from '../../../ts/alert'
  import Check from '../../UI/GUI/CheckInput.svelte'
  import Help from '../../Others/Help.svelte'
  import TextInput from '../../UI/GUI/TextInput.svelte'
  import NumberInput from '../../UI/GUI/NumberInput.svelte'
  import TextAreaInput from '../../UI/GUI/TextAreaInput.svelte'
  import { tokenizeAccurate } from 'src/ts/tokenizer'
  import { DBState } from 'src/ts/stores.svelte'
  import LoreBookList from './LoreBookList.svelte'
  import {
    currentLorebookCollectionScopedSnapshot,
    dispatchReplaceChatLorebooks,
  } from 'src/ts/server/lorebookBridge.svelte'
  import { withTrustedServerProjectionWrite } from 'src/ts/server/projectionWriteGuard.svelte'
  import { onDestroy } from 'svelte'

  const tokenCountCache = new Map<string, number>()
  const MAX_TOKEN_COUNT_CACHE = 500

  interface Props {
    value: loreBook
    onRemove?: () => void
    onClose?: (isDetail?: boolean) => void
    onOpen?: (isDetail?: boolean) => void
    lorePlus?: boolean
    idx: number
    externalLoreBooks?: loreBook[]
    idgroup: string
    isOpen?: boolean
    openFolders?: number
    isLastInContainer?: boolean
    onCollectionChange?: (entries: loreBook[]) => void
    onEntryChange?: (index: number, entry: loreBook) => void
    onEntrySettled?: (index: number) => void
    onDraftChange?: ((entry: loreBook) => void) | null
    onDraftSettled?: () => void
  }

  let {
    value = $bindable(),
    onRemove = () => {},
    onClose = (isDetail = true) => {},
    onOpen = (isDetail = true) => {},
    lorePlus = false,
    idx,
    externalLoreBooks = $bindable(),
    idgroup,
    isOpen = false,
    openFolders = 0,
    isLastInContainer = false,
    onCollectionChange = (entries: loreBook[]) => {
      externalLoreBooks = entries
    },
    onEntryChange = (index: number, entry: loreBook) => {
      const entries = [...(externalLoreBooks ?? [])]
      entries[index] = entry
      updateCollection(entries)
    },
    onEntrySettled = () => {},
    onDraftChange = null,
    onDraftSettled = () => {},
  }: Props = $props()

  let open = $derived(isOpen)
  let draft = $state<loreBook>(cloneJsonValue(value))
  let suppressDraftDispatch = false
  let draftInitialized = false
  let previousValueSnapshot = snapshotJson(value)
  let lastDraftDispatchSnapshot = snapshotJson(draft)
  let tokenPromise = $state<Promise<number> | null>(null)

  $effect(() => {
    const valueSnapshot = snapshotJson(value)
    if (valueSnapshot !== previousValueSnapshot) {
      const draftSnapshot = snapshotJson(draft)
      if (valueSnapshot !== draftSnapshot) {
        suppressDraftDispatch = true
        draft = cloneJsonValue(value)
        lastDraftDispatchSnapshot = valueSnapshot
        queueMicrotask(() => {
          suppressDraftDispatch = false
        })
      }
    }
    previousValueSnapshot = valueSnapshot
  })

  $effect(() => {
    if (!draftInitialized) {
      draftInitialized = true
      return
    }
    if (suppressDraftDispatch) return
    propagateDraft(false)
  })

  $effect(() => {
    if (!open || draft.mode === 'folder') {
      tokenPromise = null
      return
    }
    tokenPromise = getTokens(draft.content ?? '', draft.id ?? `${idx}`)
  })

  function updateCollection(entries: loreBook[]): void {
    onCollectionChange(cloneJsonValue(entries ?? []))
  }

  function propagateDraft(settled: boolean): void {
    const draftSnapshot = snapshotJson(draft)
    if (draftSnapshot !== lastDraftDispatchSnapshot) {
      const next = cloneJsonValue(draft)
      if (onDraftChange) {
        onDraftChange(next)
      } else {
        value = next
      }
      previousValueSnapshot = draftSnapshot
      lastDraftDispatchSnapshot = draftSnapshot
    }
    if (settled) onDraftSettled()
  }

  function settleDraftSoon(): void {
    queueMicrotask(() => propagateDraft(true))
  }

  function settleWhenFocusLeaves(event: FocusEvent): void {
    const currentTarget = event.currentTarget
    if (!(currentTarget instanceof HTMLElement)) return
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && currentTarget.contains(nextTarget)) return
    settleDraftSoon()
  }

  onDestroy(() => {
    propagateDraft(true)
  })

  function snapshotJson(value: unknown): string {
    const snapshot = JSON.stringify(value)
    return snapshot === undefined ? '__undefined__' : snapshot
  }

  function cloneJsonValue<T>(value: T): T {
    if (value === undefined) return value
    return JSON.parse(JSON.stringify(value)) as T
  }

  async function getTokens(data: string, cacheId: string) {
    const cacheKey = `${cacheId}:${data}`
    const cached = tokenCountCache.get(cacheKey)
    if (cached !== undefined) return cached

    await delayExpensiveDetailWork()
    const counted = await tokenizeAccurate(data)
    tokenCountCache.set(cacheKey, counted)
    if (tokenCountCache.size > MAX_TOKEN_COUNT_CACHE) {
      const oldest = tokenCountCache.keys().next().value
      if (oldest !== undefined) tokenCountCache.delete(oldest)
    }
    return counted
  }

  function delayExpensiveDetailWork(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0)
      })
    })
  }

  function isLocallyActivated(book: loreBook) {
    return book.id ? getCurrentChat()?.localLore.some((e) => e.id === book.id) : false
  }
  function activateLocally(book: loreBook) {
    withTrustedServerProjectionWrite(() => {
      if (!book.id) {
        book.id = v4()
      }

      const childLore: loreBook = {
        key: '',
        comment: '',
        content: '',
        mode: 'child',
        insertorder: 100,
        alwaysActive: true,
        secondkey: '',
        selective: false,
        id: book.id,
      }
      getCurrentChat().localLore.push(childLore)
    })
  }
  function deactivateLocally(book: loreBook) {
    if (!book.id) return
    withTrustedServerProjectionWrite(() => {
      const chat = getCurrentChat()
      const childLore = chat?.localLore?.find((e) => e.id === book.id)
      if (childLore) {
        chat.localLore = chat.localLore.filter((e) => e.id !== book.id)
      }
    })
  }
  function toggleLocalActive(check: boolean, book: loreBook) {
    // The toggle edits only the active chat's localLore, so capture the scoped
    // rollback for that one collection (L32) — not the whole-DB clone.
    const chatId = getCurrentChat()?.id
    const previous = chatId
      ? currentLorebookCollectionScopedSnapshot({ kind: 'chat', chatId })
      : null
    if (check) {
      activateLocally(book)
    } else {
      deactivateLocally(book)
    }
    const chat = getCurrentChat()
    if (chat?.id && previous) {
      dispatchReplaceChatLorebooks(chat.id, chat.localLore ?? [], previous)
    }
  }
  function getParentLoreName(book: loreBook) {
    if (book.mode === 'child') {
      const value = getCurrentCharacter()?.globalLore.find((e) => e.id === book.id)
      if (value) {
        return value.comment.length === 0
          ? value.key.length === 0
            ? 'Unnamed Lore'
            : value.key
          : value.comment
      }
    }
  }
</script>

<div
  class={'w-full flex flex-col ' +
    (isLastInContainer
      ? 'pb-0 mb-0 border-0' // Last item in container: no border
      : 'pb-2 mb-2 border-b border-b-selected last:pb-0 last:mb-0 last:border-0')}
  class:no-sort={draft.mode === 'folder' && openFolders > 0}
  data-risu-idx={idx}
  data-risu-idgroup={idgroup}
>
  <div class="flex items-center transition-colors w-full p-1">
    {#if draft.mode !== 'child'}
      <button
        class="endflex valuer border-darkborderc flex items-center"
        onclick={() => {
          if (!open) {
            open = true
            onOpen(draft.mode !== 'folder') // If not a folder, pass true
          } else {
            settleDraftSoon()
            open = false
            onClose(draft.mode !== 'folder') // If not a folder, pass true
          }
        }}
      >
        {#if draft.mode === 'folder'}
          {#if open}
            <FolderOpen size={20} class="mr-1" />
          {:else}
            <FolderIcon size={20} class="mr-1" />
          {/if}
        {/if}
        {#if draft.mode === 'folder'}
          <span>{draft.comment.length === 0 ? 'Unnamed Folder' : draft.comment}</span>
        {:else}
          <span
            >{draft.comment.length === 0
              ? draft.key.length === 0
                ? 'Unnamed Lore'
                : draft.key
              : draft.comment}</span
          >
        {/if}
      </button>
      <button
        class="mr-1"
        class:text-textcolor2={!draft.alwaysActive}
        class:text-textcolor={draft.alwaysActive}
        onclick={async () => {
          if (draft.mode === 'folder') {
            updateCollection(
              (externalLoreBooks ?? []).map((entry) =>
                entry.folder === draft.key
                  ? { ...entry, alwaysActive: !draft.alwaysActive }
                  : entry,
              ),
            )
          }
          draft.alwaysActive = !draft.alwaysActive
        }}
      >
        {#if draft.alwaysActive}
          <SunIcon size={20} />
        {:else}
          <LinkIcon size={20} />
        {/if}
      </button>
      <button
        class="valuer"
        onclick={async () => {
          let shouldRemove = true
          if (
            draft.mode === 'folder' &&
            (externalLoreBooks ?? []).some((e) => e.folder === draft.key)
          ) {
            const firstConfirm = await alertConfirm(language.folderRemoveConfirm)
            if (!firstConfirm) {
              shouldRemove = false
            }
          }

          if (shouldRemove) {
            const secondConfirm = await alertConfirm(
              language.removeConfirm + (draft.comment || 'Unnamed Folder'),
            )
            if (secondConfirm) {
              if (!open) {
                onClose()
              }
              deactivateLocally(draft)
              onRemove()
            }
          }
        }}
      >
        <XIcon size={20} />
      </button>
    {:else}
      <button
        class="endflex valuer border-darkborderc"
        onclick={() => alertMd(language.childLoreDesc)}
      >
        <BookCopyIcon size={20} class="mr-1" />
        <span>{getParentLoreName(draft)}</span>
      </button>
      <button
        class="valuer"
        onclick={async () => {
          const d = await alertConfirm(language.removeConfirm + getParentLoreName(draft))
          if (d) {
            if (!open) {
              onClose()
            }
            onRemove()
          }
        }}
      >
        <XIcon size={20} />
      </button>
    {/if}
  </div>
  {#if open}
    {#if draft.mode === 'folder'}
      <div
        class="border-0 outline-hidden w-full mt-2 flex flex-col mb-2"
        onfocusout={settleWhenFocusLeaves}
      >
        <span class="text-textcolor mt-6 mb-2">{language.folderName}</span>
        <TextInput size="sm" bind:value={draft.comment} />

        <div class="mt-4">
          <LoreBookList
            {externalLoreBooks}
            showFolder={draft.key}
            {onCollectionChange}
            {onEntryChange}
            {onEntrySettled}
          />
        </div>

        <div class="mt-2 flex gap-1">
          <button
            class="text-textcolor2 hover:text-textcolor"
            onclick={() => {
              updateCollection([
                ...(externalLoreBooks ?? []),
                {
                  key: '',
                  comment: '',
                  content: '',
                  mode: 'normal',
                  insertorder: 100,
                  alwaysActive: true,
                  secondkey: '',
                  selective: false,
                  folder: draft.key,
                },
              ])
            }}
          >
            <PlusIcon size={20} />
          </button>
        </div>
      </div>
    {:else}
      <div
        class="border-0 outline-hidden w-full mt-2 flex flex-col mb-2"
        onfocusout={settleWhenFocusLeaves}
      >
        <span class="text-textcolor mt-6">{language.name} <Help key="loreName" /></span>
        <TextInput size="sm" bind:value={draft.comment} />
        {#if !lorePlus}
          {#if !draft.alwaysActive}
            <span class="text-textcolor mt-6"
              >{language.activationKeys} <Help key="loreActivationKey" /></span
            >
            <span class="text-xs text-textcolor2">{language.activationKeysInfo}</span>
            <TextInput size="sm" bind:value={draft.key} />

            {#if draft.selective}
              <span class="text-textcolor mt-6">{language.SecondaryKeys}</span>
              <span class="text-xs text-textcolor2">{language.activationKeysInfo}</span>
              <TextInput size="sm" bind:value={draft.secondkey} />
            {/if}
          {/if}
        {/if}
        {#if !lorePlus}
          {#if !(draft.activationPercent === undefined || draft.activationPercent === null)}
            <span class="text-textcolor mt-6">{language.activationProbability}</span>
            <NumberInput
              size="sm"
              bind:value={draft.activationPercent}
              onChange={() => {
                if (
                  isNaN(draft.activationPercent) ||
                  !draft.activationPercent ||
                  draft.activationPercent < 0
                ) {
                  draft.activationPercent = 0
                }
                if (draft.activationPercent > 100) {
                  draft.activationPercent = 100
                }
              }}
            />
          {/if}
        {/if}
        {#if !lorePlus}
          <span class="text-textcolor mt-4">{language.insertOrder} <Help key="loreorder" /></span>
          <NumberInput size="sm" bind:value={draft.insertorder} min={0} max={1000} />
        {/if}
        <span class="text-textcolor mt-4 mb-2">{language.prompt}</span>
        <TextAreaInput highlight autocomplete="off" bind:value={draft.content} />
        {#if tokenPromise}
          {#await tokenPromise}
            <span class="text-textcolor2 mt-2 mb-2 text-sm">... {language.tokens}</span>
          {:then e}
            <span class="text-textcolor2 mt-2 mb-2 text-sm">{e} {language.tokens}</span>
          {/await}
        {/if}
        <div class="flex items-center mt-4">
          <Check bind:check={draft.alwaysActive} name={language.alwaysActive} />
        </div>
        {#if !draft.alwaysActive && getCurrentCharacter()?.globalLore?.some((entry) => entry.id && draft.id && entry.id === draft.id) && DBState.db.localActivationInGlobalLorebook}
          <div class="flex items-center mt-2">
            <Check
              check={isLocallyActivated(draft)}
              onChange={(check: boolean) => toggleLocalActive(check, draft)}
              name={language.alwaysActiveInChat}
            />
          </div>
        {/if}
        {#if !lorePlus && !draft.useRegex}
          <div class="flex items-center mt-2">
            <Check bind:check={draft.selective} name={language.selective} />
            <Help key="loreSelective" name={language.selective} />
          </div>
        {/if}
        {#if !lorePlus && !draft.alwaysActive}
          <div class="flex items-center mt-2">
            <Check bind:check={draft.useRegex} name={language.useRegexLorebook} />
            <Help key="useRegexLorebook" name={language.useRegexLorebook} />
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .valuer:hover {
    color: rgba(16, 185, 129, 1);
    cursor: pointer;
  }

  .endflex {
    display: flex;
    flex-grow: 1;
    cursor: pointer;
  }

  /* Styles for SortableJS drag-and-drop feedback */
  :global(.risu-chosen-item) {
    /* The item being dragged */
    padding-bottom: 0.5rem;
    margin-bottom: 0.5rem;
    border-bottom: 1px solid;
    border-bottom-color: var(--risu-theme-selected);
    opacity: 0.7;
  }

  :global(.risu-ghost-item) {
    /* The placeholder for the drop location */
    background-color: rgba(var(--risu-theme-selected-rgb), 0.2);
  }
</style>
