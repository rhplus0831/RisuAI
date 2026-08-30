import { Buffer } from 'buffer'
import { v4 } from 'uuid'
import { getDatabase, type Message, type character } from '../../storage/database.svelte'
import { readImage } from '../../globalApi.svelte'
import { getModelInfo, LLMFlags } from '../../model/modellist'
import { getUserName } from '../../utilState'
import { getInlayAsset } from '../files/inlays'
import type { MultiModal, OpenAIChat } from '../index.svelte'
import { getModuleAssets } from '../modules'
import { risuChatParser, processScriptFull } from '../scripts'
import { runImageEmbedding } from '../transformers'

export interface FormatHistoryMessageArgs {
  msg: Message
  index: number
  /** ms.length, used for the maxThoughtTagDepth clamp. */
  totalCount: number
  currentChar: character
  modelId: string
  usingPromptTemplate: boolean
  findCharacterbyIdwithCache: (id: string) => character
}

/**
 * Convert one Message to one OpenAIChat. Mirrors the inline per-message
 * conversion that used to live inside sendChat. Side effects:
 *  - mutates msg.chatId (backfills with a uuid when missing)
 *  - calls processScriptFull('editprocess', ...)
 *  - calls runImageEmbedding for image inlays when the model lacks
 *    LLMFlags.hasImageInput
 *  - calls readImage when {{asset_prompt::...}} resolves
 *
 * The findCharacterbyIdwithCache callback caches lookups across all
 * messages within one sendChat invocation; the helper does not own that
 * cache.
 */
export async function formatHistoryMessage(args: FormatHistoryMessageArgs): Promise<OpenAIChat> {
  const { msg, index, totalCount, currentChar, modelId, usingPromptTemplate, findCharacterbyIdwithCache } = args
  const nowChatroom = currentChar

  let formatedChat = (
    await processScriptFull(
      nowChatroom,
      risuChatParser(msg.data, { chara: currentChar, role: msg.role }),
      'editprocess',
      index,
      { chatRole: msg.role },
    )
  ).data

  // Retained parity lookup: `_name` is not read after this block. The `sendName`
  // wrapper below resolves its character name independently when enabled.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let _name = ''
  if (msg.role === 'char') {
    if (msg.saying) {
      _name = `${findCharacterbyIdwithCache(msg.saying).name}`
    } else {
      _name = `${currentChar.name}`
    }
  } else if (msg.role === 'user') {
    _name = `${getUserName()}`
  }

  if (!msg.chatId) {
    msg.chatId = v4()
  }

  const inlays: string[] = []
  if (msg.role === 'char') {
    formatedChat = formatedChat.replace(
      /{{(inlay|inlayed|inlayeddata)::(.+?)}}/g,
      (_match: string, p1: string, p2: string) => {
        if (p2 && p1 === 'inlayeddata') {
          inlays.push(p2)
        }
        return ''
      },
    )
  } else {
    const inlayMatch = formatedChat.match(/{{(inlay|inlayed|inlayeddata)::(.+?)}}/g)
    if (inlayMatch) {
      for (const inlay of inlayMatch) {
        inlays.push(inlay)
      }
    }
  }

  const multimodal: MultiModal[] = []
  const modelinfo = getModelInfo(modelId)
  if (inlays.length > 0) {
    for (const inlay of inlays) {
      const inlayName = inlay
        .replace('{{inlayed::', '')
        .replace('{{inlay::', '')
        .replace('}}', '')
        .replace('{{inlayeddata::', '')
      const inlayData = await getInlayAsset(inlayName)
      if (inlayData?.type === 'image') {
        if (modelinfo.flags.includes(LLMFlags.hasImageInput)) {
          multimodal.push({
            type: 'image',
            base64: inlayData.data,
            width: inlayData.width,
            height: inlayData.height,
          })
        } else {
          const captionResult = await runImageEmbedding(inlayData.data)
          formatedChat += `[${captionResult[0].generated_text}]`
        }
      }
      if (inlayData?.type === 'video' || inlayData?.type === 'audio') {
        if (multimodal.length === 0) {
          multimodal.push({
            type: inlayData.type,
            base64: inlayData.data,
          })
        }
      }
      if (inlayData?.type === 'signature') {
        multimodal.push({
          type: 'signature',
          base64: inlayData.data,
        })
      }
      formatedChat = formatedChat.replace(inlay, '')
    }
  }

  const attr: string[] = []
  const role: 'user' | 'assistant' | 'system' = msg.role === 'user' ? 'user' : 'assistant'

  if (usingPromptTemplate && getDatabase().promptSettings.sendName) {
    const form = `<{{char}}\'s Message>\n{{slot}}\n</{{char}}\'s Message>`
    formatedChat = risuChatParser(form, {
      chara: findCharacterbyIdwithCache(msg.saying).name,
    }).replace('{{slot}}', formatedChat)
  }

  const thoughts: string[] = []
  const maxThoughtDepth = getDatabase().promptSettings?.maxThoughtTagDepth ?? -1
  formatedChat = formatedChat.replace(/<Thoughts>(.+)<\/Thoughts>/gms, (_match, p1) => {
    if (maxThoughtDepth === -1 || maxThoughtDepth - totalCount <= index) {
      thoughts.push(p1)
    }
    return ''
  })

  const assetPromises: Promise<void>[] = []
  formatedChat = formatedChat.replace(/\{\{asset_?prompt::(.+?)\}\}/gimsu, (_match, p1) => {
    const moduleAssets = getModuleAssets()
    const assets = (currentChar.additionalAssets ?? []).concat(moduleAssets)
    const asset = assets.find((v) => v[0] === p1)
    if (asset) {
      assetPromises.push(
        (async () => {
          const assetDataBuf = await readImage(asset[1])
          multimodal.push({
            type: 'image',
            base64: `data:image/png;base64,${Buffer.from(assetDataBuf).toString('base64')}`,
          })
        })(),
      )
    } else if (p1 === 'icon') {
      assetPromises.push(
        (async () => {
          const assetDataBuf = await readImage(currentChar.image ?? '')
          multimodal.push({
            type: 'image',
            base64: `data:image/png;base64,${Buffer.from(assetDataBuf).toString('base64')}`,
          })
        })(),
      )
    }
    return ''
  })
  await Promise.all(assetPromises)

  const chat: OpenAIChat = {
    role: role,
    content: formatedChat,
    memo: msg.chatId,
    attr: attr,
    multimodals: multimodal,
    thoughts: thoughts,
  }
  if (chat.multimodals.length === 0) {
    delete chat.multimodals
  }
  return chat
}
