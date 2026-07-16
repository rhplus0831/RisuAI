<script lang="ts">
  import type { character } from 'src/ts/storage/database.svelte'
  import AuthorNoteEditor from './AuthorNoteEditor.svelte'

  interface Props {
    initialCharacter: character
  }

  let { initialCharacter }: Props = $props()
  const readInitialCharacter = () => initialCharacter
  let chara = $state(readInitialCharacter())

  export function switchChat(chatPage: number) {
    chara.chatPage = chatPage
  }

  export function setCurrentChatNote(note: string) {
    const chat = chara.chats[chara.chatPage]
    if (chat) chat.note = note
  }
</script>

<AuthorNoteEditor {chara} />
