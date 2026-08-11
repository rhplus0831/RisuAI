import { getDatabase, type Message } from 'src/ts/storage/database.svelte'
import { downloadFile } from 'src/ts/globalApi.svelte'
import { HypaProcesser } from '../memory/hypamemory'
import { BufferToText as BufferToText } from 'src/ts/util'
import { selectMultipleFile } from 'src/ts/filePicker'
import { postInlayAsset } from './inlays'
import {
  appendCurrentChatUserMessageForSend,
  captureActiveChatTarget,
  isActiveChatTargetFresh,
  type ActiveChatTarget,
} from 'src/ts/chatCommands'
import { hydrateChatMessages } from 'src/ts/server/chatMessageHydration.svelte'
import { coordinateAcceptedChatSend } from '../acceptedSendCoordinator.svelte'
import { canUseGenerationOperationProtocol } from 'src/ts/server/generationOperations'

type sendTextFileArg = {
  file: string
  query: string
}

type sendPDFFileArg = {
  data: Uint8Array | ArrayBuffer
  query: string
}

const poExtractedNoteMarker = /^#\. Notes? =/

function messagesForCapturedTarget(target: ActiveChatTarget): Message[] | null {
  const characters = getDatabase().characters ?? []
  const character = target.characterId
    ? characters.find((candidate) => candidate.chaId === target.characterId)
    : characters[target.selectedCharID]
  if (!character) return null

  const chat = target.chatId
    ? character.chats?.find((candidate) => candidate.id === target.chatId)
    : character.chats?.[target.chatPage]
  return chat?.message ?? null
}

function adjacentAssistantResult(messages: readonly Message[], acceptedMessageId: string): Message | null {
  let acceptedIndex = -1
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.chatId !== acceptedMessageId || message.role !== 'user') continue
    if (acceptedIndex !== -1) return null
    acceptedIndex = index
  }
  if (acceptedIndex < 0) return null

  const assistant = messages[acceptedIndex + 1]
  return assistant?.role === 'char' ? assistant : null
}

async function resolveAcceptedAssistantResult(
  target: ActiveChatTarget,
  acceptedMessageId: string,
): Promise<Message | null> {
  const projected = messagesForCapturedTarget(target)
  const projectedResult = projected ? adjacentAssistantResult(projected, acceptedMessageId) : null
  if (projectedResult) return projectedResult
  if (!target.chatId) return null

  try {
    await hydrateChatMessages(target.chatId, { force: true, strict: true })
  } catch {
    return null
  }

  const reconciled = messagesForCapturedTarget(target)
  return reconciled ? adjacentAssistantResult(reconciled, acceptedMessageId) : null
}

async function sendPofile(arg: sendTextFileArg): Promise<boolean> {
  let result = ''
  let msgId = ''
  let note = ''
  let speaker = ''
  let parseMode = 0
  const target = captureActiveChatTarget()
  if (!isActiveChatTargetFresh(target)) return false
  const flushEntry = async (): Promise<boolean> => {
    if (msgId === '') return true

    let text = msgId
    if (speaker !== '') {
      text = `Speaker: ${speaker}\n${text}`
    }
    if (note !== '') {
      text = `Note: ${note}\n${text}`
    }
    if (!isActiveChatTargetFresh(target)) return false
    let acceptedMessageId: string
    if (canUseGenerationOperationProtocol()) {
      const outcome = await coordinateAcceptedChatSend({ target, message: text })
      if (outcome.status !== 'generated' || !('acceptedMessageId' in outcome)) return false
      acceptedMessageId = outcome.acceptedMessageId
    } else {
      const appendResult = await appendCurrentChatUserMessageForSend(text, { expectedTarget: target })
      if (appendResult.status === 'error') return false
      const outcome = await coordinateAcceptedChatSend({ target, append: appendResult })
      if (outcome.status !== 'generated') return false
      acceptedMessageId = appendResult.messageId
    }

    const assistant = await resolveAcceptedAssistantResult(target, acceptedMessageId)
    if (!assistant) return false
    const msgStr = assistant.data
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => `"${line.replaceAll('"', '\\"')}"`)
      .join('\n')
    result += `msgstr ""\n${msgStr}\n\n`
    note = ''
    speaker = ''
    msgId = ''
    parseMode = 0
    return true
  }

  const lines = arg.file.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '') {
      if (msgId === '') {
        result += '\n'
        continue
      }
      if (!(await flushEntry())) return false
      continue
    }
    if (poExtractedNoteMarker.test(line)) {
      note = line.replace(poExtractedNoteMarker, '').trim()
      continue
    }
    if (line.startsWith('#. Speaker =')) {
      speaker = line.replace('#. Speaker =', '').trim()
      continue
    }
    if (line.startsWith('msgid')) {
      parseMode = 0
      msgId = line.replace('msgid ', '').trim().replaceAll('\\"', '♠#').replaceAll('"', '').replaceAll('♠#', '\\"')
      if (msgId === '') {
        parseMode = 1
      }
      result += line + '\n'
      continue
    }
    if (parseMode === 1 && line.startsWith('"') && line.endsWith('"')) {
      msgId += line.substring(1, line.length - 1).replaceAll('\\"', '"')
      result += line + '\n'
      continue
    }
    if (line.startsWith('msgstr')) {
      if (msgId === '') {
        result += line + '\n'
        parseMode = 0
      } else {
        parseMode = 2
      }
      continue
    }
    if (parseMode === 2 && line.startsWith('"') && line.endsWith('"')) {
      continue
    }
    result += line + '\n'
  }
  if (!(await flushEntry())) return false
  await downloadFile('translated.po', result)
  return true
}

async function sendPDFFile(arg: sendPDFFileArg) {
  const pdfjsLib = await import('pdfjs-dist')
  const pdfjsWorker = await import('pdfjs-dist/build/pdf.worker?worker&url')
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker.default
  const pdf = await pdfjsLib.getDocument({ data: arg.data }).promise
  const texts: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const items = content.items as { str: string }[]
    for (const item of items) {
      texts.push(item.str)
    }
  }
  const hypa = new HypaProcesser()
  await hypa.addText(texts)
  const result = await hypa.similaritySearch(arg.query)
  let message = ''
  for (let i = 0; i < result.length; i++) {
    message += '\n' + result[i]
    if (i > 5) {
      break
    }
  }
  return Buffer.from(`<File>\n${message}\n</File>\n`).toString('base64')
}

async function sendTxtFile(arg: sendTextFileArg) {
  const lines = arg.file.split('\n').filter((a) => {
    return a !== ''
  })
  const hypa = new HypaProcesser()
  await hypa.addText(lines)
  const result = await hypa.similaritySearch(arg.query)
  let message = ''
  for (let i = 0; i < result.length; i++) {
    message += '\n' + result[i]
    if (i > 5) {
      break
    }
  }
  return Buffer.from(`<File>\n${message}\n</File>\n`).toString('base64')
}

async function sendXMLFile(arg: sendTextFileArg) {
  const hypa = new HypaProcesser()
  let nodeTexts: string[] = []
  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(arg.file, 'text/xml')
  const nodes = xmlDoc.getElementsByTagName('*')
  for (const node of nodes) {
    nodeTexts.push(node.textContent)
  }
  await hypa.addText(nodeTexts)
  const result = await hypa.similaritySearch(arg.query)
  let message = ''
  for (let i = 0; i < result.length; i++) {
    message += '\n' + result[i]
    if (i > 5) {
      break
    }
  }
  return Buffer.from(`<File>\n${message}\n</File>\n`).toString('base64')
}

type postFileResult = postFileResultAsset | postFileResultVoid | postFileResultText

type postFileResultAsset = {
  data: string
  type: 'asset'
}

type postFileResultVoid = {
  type: 'void'
}

type postFileResultText = {
  data: string
  type: 'text'
  name: string
}
export async function postChatFile(
  query:
    | string
    | {
        name: string
        data: Uint8Array
      },
): Promise<postFileResult[] | null> {
  const files =
    typeof query === 'string'
      ? await selectMultipleFile([
          //image format
          'jpg',
          'jpeg',
          'png',
          'webp',
          'gif',
          'avif',

          //audio format
          'wav',
          'mp3',
          'ogg',
          'flac',

          //video format
          'mp4',
          'webm',
          'mpeg',
          'avi',

          //other format
          'po',
          // 'pdf',
          'txt',
        ]).catch(() => [])
      : [query]

  if (!files) {
    return null
  }

  const xquery = typeof query === 'string' ? query : ''
  const results: postFileResult[] = []

  for (const file of files) {
    const extention = file.name.split('.').at(-1)

    switch (extention) {
      case 'po': {
        let translated = false
        try {
          translated = await sendPofile({
            file: BufferToText(file.data),
            query: xquery,
          })
        } catch {
          continue
        }
        if (!translated) {
          break
        }
        results.push({
          type: 'void',
        })
        break
      }
      case 'pdf': {
        results.push({
          type: 'text',
          data: await sendPDFFile({
            data: file.data,
            query: xquery,
          }),
          name: file.name,
        })
        break
      }
      case 'xml': {
        results.push({
          type: 'text',
          data: await sendXMLFile({
            file: BufferToText(file.data),
            query: xquery,
          }),
          name: file.name,
        })
        break
      }

      //image format
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'webp':
      case 'gif':
      case 'avif':

      //audio format
      case 'wav':
      case 'mp3':
      case 'ogg':
      case 'flac':

      //video format
      case 'mp4':
      case 'webm':
      case 'mpeg':
      case 'avi': {
        const postData = await postInlayAsset(file)
        if (!postData) {
          continue
        }
        results.push({
          data: postData,
          type: 'asset',
        })
        break
      }
      case 'txt': {
        results.push({
          type: 'text',
          data: await sendTxtFile({
            file: BufferToText(file.data),
            query: xquery,
          }),
          name: file.name,
        })
        break
      }
    }
  }

  return results
}
