<script lang="ts">
  import { onDestroy, untrack } from 'svelte'

  import { language } from 'src/lang'
  import { setChatNoteValue } from 'src/ts/chatCommands'
  import type { character } from 'src/ts/storage/database.svelte'
  import { tokenizeAccurate } from 'src/ts/tokenizer'
  import { getAuthorNoteDefaultText } from 'src/ts/util'

  import Help from '../Others/Help.svelte'
  import TextAreaInput from '../UI/GUI/TextAreaInput.svelte'

  interface Props {
    chara: character
  }

  let { chara }: Props = $props()

  let authorNoteDraft = $state('')
  let authorNoteChatId: string | null = $state(null)
  let authorNoteServerNote = ''
  let authorNoteLastSubmitted = ''
  let tokenCount = $state(0)
  let lastTokenizedNote = ''
  let tokenizeRun = 0
  let authorNoteSaveTimer: ReturnType<typeof setTimeout> | null = null
  let pendingAuthorNoteSave: { chatId: string; note: string } | null = null

  async function loadTokenCount(note: string, run: number): Promise<void> {
    if (lastTokenizedNote === note) return
    const count = await tokenizeAccurate(note)
    if (run !== tokenizeRun) return
    lastTokenizedNote = note
    tokenCount = count
  }

  function scheduleTokenize(note: string): void {
    const run = ++tokenizeRun
    setTimeout(() => {
      requestAnimationFrame(() => {
        if (run !== tokenizeRun) return
        void loadTokenCount(note, run)
      })
    }, 0)
  }

  function clearAuthorNoteSaveTimer(): void {
    if (!authorNoteSaveTimer) return
    clearTimeout(authorNoteSaveTimer)
    authorNoteSaveTimer = null
  }

  function clearPendingAuthorNoteSave(): void {
    clearAuthorNoteSaveTimer()
    pendingAuthorNoteSave = null
  }

  function flushPendingAuthorNoteSave(): void {
    const pending = pendingAuthorNoteSave
    if (!pending) return
    clearAuthorNoteSaveTimer()
    pendingAuthorNoteSave = null
    if (pending.note === authorNoteLastSubmitted) return
    authorNoteLastSubmitted = pending.note
    setChatNoteValue(pending.chatId, pending.note)
  }

  function scheduleAuthorNoteSave(chatId: string, note: string): void {
    clearAuthorNoteSaveTimer()
    pendingAuthorNoteSave = { chatId, note }
    authorNoteSaveTimer = setTimeout(flushPendingAuthorNoteSave, 250)
  }

  $effect.pre(() => {
    const note = authorNoteDraft
    untrack(() => {
      scheduleTokenize(note)
    })
  })

  $effect(() => {
    const chat = chara?.chats?.[chara.chatPage]
    const nextChatId = chat?.id ?? null
    const nextNote = chat?.note ?? ''
    if (nextChatId !== authorNoteChatId) {
      untrack(flushPendingAuthorNoteSave)
      authorNoteChatId = nextChatId
      authorNoteDraft = nextNote
      authorNoteServerNote = nextNote
      authorNoteLastSubmitted = nextNote
    } else if (nextNote !== authorNoteServerNote) {
      authorNoteServerNote = nextNote
      if (authorNoteDraft === authorNoteLastSubmitted) {
        authorNoteDraft = nextNote
      }
      authorNoteLastSubmitted = nextNote
    }
  })

  $effect(() => {
    const chatId = authorNoteChatId
    const note = authorNoteDraft
    if (!chatId || note === authorNoteLastSubmitted) {
      clearPendingAuthorNoteSave()
      return
    }

    scheduleAuthorNoteSave(chatId, note)

    return () => {
      clearAuthorNoteSaveTimer()
    }
  })

  onDestroy(flushPendingAuthorNoteSave)
</script>

<div data-risu-chat-author-note>
  <span class="text-textcolor">{language.authorNote} <Help key="chatNote" /></span>
  <TextAreaInput
    margin="both"
    autocomplete="off"
    ariaLabel={language.authorNote}
    bind:value={authorNoteDraft}
    highlight
    placeholder={getAuthorNoteDefaultText()} />
  <span class="text-textcolor2 mb-6 text-sm">{tokenCount} {language.tokens}</span>
</div>
