<!--
  A4R-group-chat-removed fixture (failing): the new-chat handler reintroduces a
  group-chat member-seeding branch inside a markup event handler.
-->
<script>
  import { findCharacterbyId } from '../../ts/util'
  let cha = {}
</script>

<button
  onclick={() => {
    const chat = { message: [] }
    if (cha.type === 'group') {
      cha.characters.map((c) => {
        chat.message.push({ saying: c, role: 'char', data: findCharacterbyId(c).firstMessage })
      })
    }
  }}>New</button>
