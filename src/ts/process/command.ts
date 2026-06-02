import { get } from 'svelte/store'
import {
  getCurrentCharacter,
  getCurrentChat,
  getDatabase,
  setCurrentChat,
  setDatabase,
} from '../storage/database.svelte'
import { selectedCharID } from '../stores.svelte'
import { alertInput, alertMd, alertNormal, alertSelect } from '../alert'
import { sayTTS } from './tts'
import { risuChatParser } from '../parser/parser.svelte'
import { sendChat } from './index.svelte'
import { loadLoreBookV3Prompt } from './lorebook.svelte'
import { runTrigger } from './triggers'
import {
  currentChatStateSnapshot,
  dispatchCompatibleChatUpdate,
  dispatchPatchChatScriptstate,
} from '../chatCommands'
import { withTrustedServerProjectionWrite } from '../server/projectionWriteGuard.svelte'
import type { Chat } from '../storage/database.svelte'

export async function processMultiCommand(command: string) {
  let pipe = ''
  const splited: string[] = []
  let lastIndex = 0
  let quoteDepth = false
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (char === '"') {
      quoteDepth = !quoteDepth
    } else if (char === '|' && quoteDepth === false) {
      splited.push(command.slice(lastIndex, i))
      lastIndex = i + 1
    }
  }
  splited.push(command.slice(lastIndex))
  console.log(splited)
  for (let i = 0; i < splited.length; i++) {
    const result = await processCommand(splited[i].trim(), pipe)
    console.log(pipe)
    if (result === false) {
      return false
    } else {
      pipe = result
    }
  }
  return pipe
}

async function processCommand(command: string, pipe: string): Promise<false | string> {
  const db = getDatabase()
  const currentChar = db.characters[get(selectedCharID)]
  let { commandName, arg, namedArg } = commandParser(command, pipe)

  if (!arg) {
    arg = pipe
  }

  arg = risuChatParser(arg, {
    chara: currentChar.type === 'character' ? currentChar : null,
  })

  const namedArgKeys = Object.keys(namedArg)
  for (const key of namedArgKeys) {
    namedArg[key] = risuChatParser(namedArg[key], {
      chara: currentChar.type === 'character' ? currentChar : null,
    })
  }

  switch (commandName) {
    //STScript compatibility commands
    case 'input': {
      pipe = await alertInput(arg)
      return pipe
    }
    case 'echo':
    case 'popup': {
      alertNormal(arg)
      return pipe
    }
    case 'pass': {
      pipe = arg
      return pipe
    }
    case 'buttons': {
      if (namedArg.labels) {
        try {
          const JSONLabels = JSON.parse(namedArg.labels)
          if (Array.isArray(JSONLabels)) {
            pipe = await alertSelect(JSONLabels)
          }
        } catch (error) {}
      }
      return pipe
    }
    case 'setinput': {
      //NOT IMPLEMENTED
      return false
    }
    case 'speak': {
      if (currentChar.type === 'character') {
        await sayTTS(currentChar, arg)
      }
      return pipe
    }
    case 'send': {
      mutateCurrentChatMessages((chat) => {
        chat.message.push({
          role: 'user',
          data: arg,
        })
      })
      return pipe
    }
    case 'sendas': {
      //name not implemented
      mutateCurrentChatMessages((chat) => {
        chat.message.push({
          role: 'char',
          data: arg,
        })
      })
      return pipe
    }
    case 'comment': {
      //works differently, but its close enough
      const addition = `<Comment>\n${arg}\n</Comment>`
      mutateCurrentChatMessages((chat) => {
        chat.message[chat.message.length - 1].data += addition
      })
      return pipe
    }
    case 'cut': {
      mutateCurrentChatMessages((chat) => {
        if (arg.includes('-')) {
          const [start, end] = arg.split('-')
          chat.message = chat.message.slice(parseInt(start), parseInt(end))
        } else if (!isNaN(parseInt(arg))) {
          const index = parseInt(arg)
          chat.message = chat.message.splice(index, 1)
        } else {
          //For risu, doesn'ts work for STScript
          const id = arg
          chat.message = chat.message.filter((e) => e.chatId !== id)
        }
      })
      return pipe
    }
    case 'del': {
      const size = parseInt(arg)
      if (!isNaN(size)) {
        mutateCurrentChatMessages((chat) => {
          chat.message = chat.message.slice(chat.message.length - size)
        })
      }
      return pipe
    }
    case 'len': {
      try {
        const parsed = JSON.parse(arg)
        if (Array.isArray(parsed)) {
          pipe = parsed.length.toString()
        }
      } catch (error) {}
      return pipe
    }
    case 'multisend': {
      const splited = arg.split('|||')
      let clearMode = false
      if (splited[0] && splited[0].trim() === 'clear') {
        clearMode = true
        splited.shift()
      }
      const selectedChar = get(selectedCharID)
      for (const e of splited) {
        // Optimistic local writes must not mutate the read-only server
        // projection directly; wrap them in a trusted write scope and re-read
        // the live database inside it.
        withTrustedServerProjectionWrite(() => {
          const db = getDatabase()
          const char = db.characters[selectedChar]
          const chat = char.chats[char.chatPage]
          if (clearMode) {
            chat.message = []
          }
          chat.message.push({
            role: 'user',
            data: e,
          })
          setDatabase(db)
        })
        await sendChat(-1)
      }
      return ''
    }
    case 'setvar': {
      const selectedChar = get(selectedCharID)
      const previous = currentChatStateSnapshot()
      const stateKey = '$' + namedArg['key']
      let chatId: string | undefined
      withTrustedServerProjectionWrite(() => {
        const db = getDatabase()
        const char = db.characters[selectedChar]
        const chat = char.chats[char.chatPage]
        chat.scriptstate = chat.scriptstate ?? {}
        chat.scriptstate[stateKey] = arg
        chatId = chat.id
        setDatabase(db)
      })
      if (chatId) {
        dispatchPatchChatScriptstate(chatId, { [stateKey]: arg }, [], previous)
      }
      return ''
    }
    case 'addvar': {
      const selectedChar = get(selectedCharID)
      const previous = currentChatStateSnapshot()
      const stateKey = '$' + namedArg['key']
      let chatId: string | undefined
      let newValue = ''
      withTrustedServerProjectionWrite(() => {
        const db = getDatabase()
        const char = db.characters[selectedChar]
        const chat = char.chats[char.chatPage]
        chat.scriptstate = chat.scriptstate ?? {}
        newValue = (Number(chat.scriptstate[stateKey]) + Number(arg)).toString()
        chat.scriptstate[stateKey] = newValue
        chatId = chat.id
        setDatabase(db)
      })
      if (chatId) {
        dispatchPatchChatScriptstate(chatId, { [stateKey]: newValue }, [], previous)
      }
      return ''
    }
    case 'getvar': {
      const db = getDatabase()
      const selectedChar = get(selectedCharID)
      const char = db.characters[selectedChar]
      const chat = char.chats[char.chatPage]
      pipe = chat.scriptstate?.['$' + namedArg['key']]?.toString() ?? 'null'
      return pipe
    }
    case 'test_lorebook': {
      const p = await loadLoreBookV3Prompt()
      console.log(p)
      alertNormal(p.actives.map((e) => e.prompt).join('§'))
      return JSON.stringify(p)
    }
    case 'trigger': {
      const currentChar = getCurrentCharacter()
      const triggerResult = await runTrigger(currentChar, 'manual', {
        chat: getCurrentChat(),
        manualName: arg,
      })

      if (triggerResult) {
        setCurrentChat(triggerResult.chat)
      }
      return
    }
    case '?': {
      alertMd(`
            # /input [text]
            - Show input dialog
            - Return input text
            - Example: /input Hello World
            # /echo [text]
            - Show alert dialog
            - Return input text
            - Example: /echo Hello World
            # /popup [text]
            - Show alert dialog
            - Return input text
            - Example: /popup Hello World
            # /pass [text]
            - Return input text
            - Example: /pass Hello World
            # /buttons [labels]
            - Show select dialog
            - Return selected label
            - Example: /buttons Yes§No
            # /speak [text]
            - Speak text
            - Example: /speak Hello World
            # /send [text]
            - Send text to chat
            - Example: /send Hello World
            # /sendas [text]
            - Send text to chat as character
            - Example: /sendas Hello World
            # /comment [text]
            - Add comment to chat
            - Example: /comment Hello World
            # /cut [index]
            - Cut chat message
            - Example: /cut 1
            # /del [size]
            - Delete chat message
            - Example: /del 1
            # /len [array]
            - Return length of array
            - Example: /len Hello§World
            # /setvar key=[key] [value]
            - Set variable
            - Example: /setvar key=hello world
            # /addvar key=[key] [value]
            - Add value to variable
            - Example: /addvar key=damage 10
            # /getvar key=[key]
            - Get variable
            - Example: /getvar key=damage
            # /trigger [name]
            - Run trigger
            # /?
            - Show help
            `)
      return 'help'
    }
  }
  return false
}

function snapshotChat(chat: Chat): Chat {
  return JSON.parse(JSON.stringify(chat)) as Chat
}

// Apply an optimistic mutation to the current chat's message history without
// mutating the read-only server projection in place. The mutation runs inside
// a trusted write scope against a freshly read database reference, then the
// change is forwarded to the server through the compatible chat-update command.
function mutateCurrentChatMessages(mutate: (chat: Chat) => void): void {
  const selectedChar = get(selectedCharID)
  const previous = currentChatStateSnapshot()
  const beforeChar = getDatabase().characters[selectedChar]
  const previousChat = snapshotChat(beforeChar.chats[beforeChar.chatPage])
  withTrustedServerProjectionWrite(() => {
    const db = getDatabase()
    const char = db.characters[selectedChar]
    const chat = char.chats[char.chatPage]
    mutate(chat)
    setDatabase(db)
  })
  const afterChar = getDatabase().characters[selectedChar]
  const nextChat = snapshotChat(afterChar.chats[afterChar.chatPage])
  dispatchCompatibleChatUpdate(previousChat, nextChat, previous)
}

function commandParser(command: string, pipe: string) {
  if (command.startsWith('/')) {
    command = command.slice(1)
  }
  const sliced = command.split(' ').filter((e) => e != '')
  const commandName = sliced[0]
  let argArray: string[] = []
  let namedArg: { [key: string]: string } = {}
  for (let i = 1; i < sliced.length; i++) {
    if (sliced[i].includes('=')) {
      const [key, value] = sliced[i].split('=')
      namedArg[key] = value
    } else {
      argArray.push(sliced[i])
    }
  }
  const arg = argArray
    .join(' ')
    .replace('{{pipe}}', pipe) //STScript compatibility
    .replace('{{slot}}', pipe) //Risu default
  return { commandName, arg, namedArg }
}
