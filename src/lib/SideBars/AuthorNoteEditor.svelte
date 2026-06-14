<script lang="ts">
  import { untrack } from 'svelte'

  import { language } from 'src/lang'
  import { currentChatStateSnapshot, dispatchUpdateChat } from 'src/ts/chatCommands'
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
    if (!chatId || note === authorNoteLastSubmitted) return

    const timer = setTimeout(() => {
      authorNoteLastSubmitted = note
      dispatchUpdateChat(chatId, { note }, currentChatStateSnapshot())
    }, 250)

    return () => {
      clearTimeout(timer)
    }
  })
</script>

<div data-risu-chat-author-note>
  <span class="text-textcolor">{language.authorNote} <Help key="chatNote" /></span>
  <TextAreaInput
    margin="both"
    autocomplete="off"
    bind:value={authorNoteDraft}
    highlight
    placeholder={getAuthorNoteDefaultText()} />
  <span class="text-textcolor2 mb-6 text-sm">{tokenCount} {language.tokens}</span>
</div>
