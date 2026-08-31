import { language } from 'src/lang'
import { alertConfirm } from 'src/ts/alert'
import { getCharacterDisplayName } from 'src/ts/characterDisplayName'
import {
  currentCharacterRowSnapshot,
  dispatchUpdateCharacterScoped,
  sanitizeCharacterPatch,
} from 'src/ts/characterCommands'
import { canUseServerCommands } from 'src/ts/server/commands'
import {
  charactersResourceState,
  getCharacterResourceOwner,
  settingsResourceState,
} from 'src/ts/server/resourceState.svelte'
import { hydrateCharacterShell } from 'src/ts/server/characterShellHydration.svelte'
import { ensureCharacterLorebookHydrated } from 'src/ts/server/chatMessageHydration.svelte'
// These scoped bridges remain the supported compatibility boundary for
// lorebook/script command staging, stable definition ids, and rollback.
import {
  ensureClientLorebookEntryIds,
  isCharacterLorebookHydrated,
  replaceCharacterLorebookCollectionFull,
} from 'src/ts/server/lorebookOwner.svelte'
import {
  dispatchReplaceCharacterScripts,
  dispatchReplaceCharacterTriggers,
  ensureClientScriptDefinitionIds,
  ensureClientTriggerDefinitionIds,
} from 'src/ts/server/scriptDefinitionOwner.svelte'
import { isServerCharacterShell, type character, type loreBook } from 'src/ts/storage/database.svelte'
import { pickHashRand } from 'src/ts/util'
import { createNonSecurityUuid } from 'src/ts/nonSecurityUuid'
import { type MCPTool, MCPToolHandler, type RPCToolCallContent } from '../mcplib'
import { getCharacter } from './utils'

export class CharacterHandler extends MCPToolHandler {
  constructor(private readonly abortSignal?: AbortSignal) {
    super()
  }

  private async promptAccess(tool: string, action: string) {
    if (this.abortSignal?.aborted) return false
    const accepted = await alertConfirm(
      language.mcpAccessPrompt.replace('{{tool}}', tool).replace('{{action}}', action),
    )
    return accepted && !this.abortSignal?.aborted
  }

  getTools(): MCPTool[] {
    return [
      {
        description: 'Get basic information about a Risuai character.',
        inputSchema: {
          properties: {
            fields: {
              description: 'Specific fields to include in the result.',
              items: {
                enum: [
                  'alternateGreetings',
                  'backgroundEmbedding',
                  'description',
                  'displayName',
                  'greeting',
                  'id',
                  'name',
                  'replaceGlobalNote',
                ],
                type: 'string',
              },
              type: 'array',
            },
            id: {
              description: 'The ID or name of the character. Use an empty string for the currently selected character.',
              type: 'string',
            },
          },
          required: ['id'],
          type: 'object',
        },
        name: 'risu-get-character-info',
      },
      {
        description: 'List the lorebooks of a Risuai character.',
        inputSchema: {
          properties: {
            count: {
              default: 100,
              description: 'The maximum number of lorebooks to return.',
              type: 'integer',
            },
            id: {
              description: 'The ID or name of the character. Use an empty string for the currently selected character.',
              type: 'string',
            },
            offset: {
              description: 'The number of lorebooks to skip for pagination.',
              type: 'integer',
            },
          },
          required: ['id'],
          type: 'object',
        },
        name: 'risu-list-character-lorebooks',
      },
      {
        description: 'Get lorebooks with specific names from a Risuai character.',
        inputSchema: {
          properties: {
            id: {
              description: 'The ID or name of the character. Use an empty string for the currently selected character.',
              type: 'string',
            },
            names: {
              description: 'The names of the lorebooks to retrieve.',
              items: { type: 'string' },
              type: 'array',
            },
          },
          required: ['id', 'names'],
          type: 'object',
        },
        name: 'risu-get-character-lorebook',
      },
      {
        description: 'Set basic information about a Risuai character.',
        inputSchema: {
          properties: {
            data: {
              description: 'A map of fields to their new values.',
              properties: {
                alternateGreetings: {
                  items: { type: 'string' },
                  type: 'array',
                },
                backgroundEmbedding: { type: 'string' },
                description: { type: 'string' },
                displayName: { type: 'string' },
                greeting: { type: 'string' },
                name: { type: 'string' },
                replaceGlobalNote: { type: 'string' },
              },
              type: 'object',
            },
            id: {
              description: 'The ID or name of the character. Use an empty string for the currently selected character.',
              type: 'string',
            },
          },
          required: ['data', 'id'],
          type: 'object',
        },
        name: 'risu-set-character-info',
      },
      {
        description: 'Update an existing lorebook of a Risuai character, or create a new one if it does not exist.',
        inputSchema: {
          properties: {
            alwaysActive: {
              default: false,
              description: 'If true, the lorebook is always active regardless of keywords.',
              type: 'boolean',
            },
            content: {
              description: 'The text content to be inserted into the context.',
              type: 'string',
            },
            id: {
              description: 'The ID or name of the character. Use an empty string for the currently selected character.',
              type: 'string',
            },
            keys: {
              description: 'An array of keywords that activate this lorebook.',
              items: { type: 'string' },
              type: 'array',
            },
            name: {
              description: 'The name of the lorebook to update.',
              type: 'string',
            },
            newName: {
              description: 'Optional new name for the lorebook.',
              type: 'string',
            },
          },
          required: ['id', 'name'],
          type: 'object',
        },
        name: 'risu-set-character-lorebook',
      },
      {
        description: 'Delete a lorebook from a Risuai character.',
        inputSchema: {
          properties: {
            id: {
              description: 'The ID or name of the character. Use an empty string for the currently selected character.',
              type: 'string',
            },
            name: {
              description: 'The name of the lorebook to delete.',
              type: 'string',
            },
          },
          required: ['id', 'name'],
          type: 'object',
        },
        name: 'risu-delete-character-lorebook',
      },
      {
        description: 'Get regex scripts from a Risuai character.',
        inputSchema: {
          properties: {
            id: {
              description: 'The ID or name of the character. Use an empty string for the currently selected character.',
              type: 'string',
            },
          },
          required: ['id'],
          type: 'object',
        },
        name: 'risu-get-character-regex-scripts',
      },
      {
        description: 'Update an existing regex script in a Risuai character, or create a new one if it does not exist.',
        inputSchema: {
          properties: {
            ableFlag: {
              default: false,
              description: 'Set to true to use the custom "flag" string.',
              type: 'boolean',
            },
            flag: {
              description: 'Regex flags (e.g., "g", "i", "m") used when "ableFlag" is true.',
              type: 'string',
            },
            id: {
              description: 'The ID or name of the character. Use an empty string for the currently selected character.',
              type: 'string',
            },
            in: {
              description: 'The regex pattern to match.',
              type: 'string',
            },
            name: {
              description: 'The name of the script to update.',
              type: 'string',
            },
            newName: {
              description: 'Optional new name for the script.',
              type: 'string',
            },
            out: {
              description: 'The string to replace matches with.',
              type: 'string',
            },
            type: {
              description: 'The hook where the regex is applied.',
              enum: ['editdisplay', 'editinput', 'editoutput', 'editprocess'],
              type: 'string',
            },
          },
          required: ['id', 'name'],
          type: 'object',
        },
        name: 'risu-set-character-regex-scripts',
      },
      {
        description: 'Delete a regex script from a Risuai character.',
        inputSchema: {
          properties: {
            id: {
              description: 'The ID or name of the character. Use an empty string for the currently selected character.',
              type: 'string',
            },
            name: {
              description: 'The name of the regex script to delete.',
              type: 'string',
            },
          },
          required: ['id', 'name'],
          type: 'object',
        },
        name: 'risu-delete-character-regex-scripts',
      },
      {
        description: 'Get additional assets from a Risuai character.',
        inputSchema: {
          properties: {
            id: {
              description: 'The ID or name of the character. Use an empty string for the currently selected character.',
              type: 'string',
            },
          },
          required: ['id'],
          type: 'object',
        },
        name: 'risu-get-character-additional-assets',
      },
      {
        description: 'Get the Lua script from a Risuai character trigger.',
        inputSchema: {
          properties: {
            id: {
              description: 'The ID or name of the character. Use an empty string for the currently selected character.',
              type: 'string',
            },
          },
          required: ['id'],
          type: 'object',
        },
        name: 'risu-get-character-lua-script',
      },
      {
        description: 'Update the Lua script of a Risuai character.',
        inputSchema: {
          properties: {
            code: {
              description: 'The new Lua code.',
              type: 'string',
            },
            id: {
              description: 'The ID or name of the character. Use an empty string for the currently selected character.',
              type: 'string',
            },
          },
          required: ['code', 'id'],
          type: 'object',
        },
        name: 'risu-set-character-lua-script',
      },
      {
        description: 'Delete an additional asset from a Risuai character.',
        inputSchema: {
          properties: {
            assetName: {
              description: 'The name of the asset to delete.',
              type: 'string',
            },
            id: {
              description: 'The ID or name of the character. Use an empty string for the currently selected character.',
              type: 'string',
            },
          },
          required: ['assetName', 'id'],
          type: 'object',
        },
        name: 'risu-delete-character-additional-assets',
      },
      {
        description: 'List all Risuai characters.',
        inputSchema: {
          properties: {
            count: {
              default: 100,
              description: 'The maximum number of characters to return.',
              type: 'integer',
            },
            offset: {
              description: 'The number of characters to skip for pagination.',
              type: 'integer',
            },
          },
          required: [],
          type: 'object',
        },
        name: 'risu-list-characters',
      },
    ]
  }

  async handle(toolName: string, args: any): Promise<RPCToolCallContent[] | null> {
    switch (toolName) {
      case 'risu-get-character-info':
        return await this.getCharacterInfo(args.id, args.fields)
      case 'risu-list-character-lorebooks':
        return await this.getCharacterLorebooks(args.id, args.count, args.offset)
      case 'risu-get-character-lorebook':
        return await this.getCharacterLorebook(args.id, args.names)
      case 'risu-set-character-info':
        return await this.setCharacterInfo(args.id, args.data)
      case 'risu-set-character-lorebook':
        return await this.setCharacterLorebook(
          args.id,
          args.name,
          args.content,
          args.keys,
          args.newName,
          args.alwaysActive,
        )
      case 'risu-delete-character-lorebook':
        return await this.deleteCharacterLorebook(args.id, args.name)
      case 'risu-get-character-regex-scripts':
        return await this.getCharacterRegexScripts(args.id)
      case 'risu-set-character-regex-scripts':
        return await this.setCharacterRegexScripts(
          args.id,
          args.name,
          args.newName,
          args.in,
          args.out,
          args.type,
          args.flag,
          args.ableFlag,
        )
      case 'risu-delete-character-regex-scripts':
        return await this.deleteCharacterRegexScripts(args.id, args.name)
      case 'risu-get-character-additional-assets':
        return await this.getCharacterAdditionalAssets(args.id)
      case 'risu-get-character-lua-script':
        return await this.getCharacterLuaScript(args.id)
      case 'risu-set-character-lua-script':
        return await this.setCharacterLuaScript(args.id, args.code)
      case 'risu-delete-character-additional-assets':
        return await this.deleteCharacterAdditionalAssets(args.id, args.assetName)
      case 'risu-list-characters':
        return await this.listCharacters(args.count, args.offset)
    }
    return null
  }

  async getCharacterInfo(id: string, fields: string[]): Promise<RPCToolCallContent[]> {
    const characterOwner = getDetailCharacterOwner(id)
    const char = characterOwner instanceof Promise ? await characterOwner : characterOwner
    if (!char) {
      return [
        {
          type: 'text',
          text: `Error: Character with ID ${id} not found.`,
        },
      ]
    }

    let response: Record<string, any> = {}

    const fieldRemap = {
      name: 'name',
      displayName: 'displayName',
      greeting: 'firstMessage',
      description: 'desc',
      id: 'chaId',
      replaceGlobalNote: 'replaceGlobalNote',
      alternateGreetings: 'alternateGreetings',
      backgroundEmbedding: 'backgroundHTML',
    } as const

    for (const field of fields) {
      if (fieldRemap[field as keyof typeof fieldRemap]) {
        const realField = fieldRemap[field as keyof typeof fieldRemap]
        response[field] = char[realField]
      } else {
        return [
          {
            type: 'text',
            text: `Error: Field ${field} does not exist on character ${char.chaId} or it isn't allowed to be accessed.`,
          },
        ]
      }
    }

    return [
      {
        type: 'text',
        text: JSON.stringify(response),
      },
    ]
  }

  async getCharacterLorebooks(id: string, count: number = 100, offset: number = 0): Promise<RPCToolCallContent[]> {
    const detailOwner = getDetailCharacterOwner(id)
    const detailChar = detailOwner instanceof Promise ? await detailOwner : detailOwner
    if (!detailChar) {
      return [
        {
          type: 'text',
          text: `Error: Character with ID ${id} not found.`,
        },
      ]
    }
    const lorebookOwner = getLorebookCharacterOwner(detailChar)
    const char = lorebookOwner instanceof Promise ? await lorebookOwner : lorebookOwner
    if (!char) return characterLorebookNotReadyResponse(detailChar)

    if (count > 100) count = 100
    if (count < 1) count = 1
    if (offset < 0) offset = 0

    const lorebook = char.globalLore.slice(offset, offset + count)
    const organized = lorebook.map((entry) => {
      return {
        alwaysActive: entry.alwaysActive,
        keys: entry.key,
        name: entry.comment || 'Unnamed ' + pickHashRand(5515, entry.content),
      }
    })

    return [
      {
        type: 'text',
        text: JSON.stringify(organized),
      },
    ]
  }

  async getCharacterLorebook(id: string, entryNames: string[]): Promise<RPCToolCallContent[]> {
    const detailOwner = getDetailCharacterOwner(id)
    const detailChar = detailOwner instanceof Promise ? await detailOwner : detailOwner
    if (!detailChar) {
      return [
        {
          type: 'text',
          text: `Error: Character with ID ${id} not found.`,
        },
      ]
    }
    const lorebookOwner = getLorebookCharacterOwner(detailChar)
    const char = lorebookOwner instanceof Promise ? await lorebookOwner : lorebookOwner
    if (!char) return characterLorebookNotReadyResponse(detailChar)

    const entries = char.globalLore.filter((entry) => {
      const displayName = entry.comment || 'Unnamed ' + pickHashRand(5515, entry.content)
      return entryNames.includes(displayName)
    })

    if (entries.length === 0) {
      return [
        {
          type: 'text',
          text: `Error: Lorebook entries with names "${entryNames.join(', ')}" not found.`,
        },
      ]
    }

    const result = entries.map((entry) => ({
      alwaysActive: entry.alwaysActive,
      content: entry.content,
      keys: entry.key,
      name: entry.comment || 'Unnamed ' + pickHashRand(5515, entry.content),
    }))

    return [
      {
        type: 'text',
        text: JSON.stringify(result),
      },
    ]
  }

  async setCharacterInfo(id: string, data: any): Promise<RPCToolCallContent[]> {
    const characterOwner = getDetailCharacterOwner(id)
    const char = characterOwner instanceof Promise ? await characterOwner : characterOwner
    if (!char) {
      return [
        {
          type: 'text',
          text: `Error: Character with ID ${id} not found.`,
        },
      ]
    }
    const characterId = char.chaId
    const characterRef = char

    const displayName = characterAccessName(char)
    if (!(await this.promptAccess('risu-set-character-info', `modify character (${displayName}) information`))) {
      return [
        {
          type: 'text',
          text: 'Access denied by user.',
        },
      ]
    }

    const liveChar = getCharacterResourceOwner(characterId)
    if (!liveChar) {
      return [
        {
          type: 'text',
          text: `Error: Character with ID ${id} not found.`,
        },
      ]
    }
    if (liveChar !== characterRef) {
      return [
        {
          type: 'text',
          text: `Error: Character with ID ${id} changed before access was accepted. Please retry.`,
        },
      ]
    }

    const fieldRemap = {
      name: 'name',
      displayName: 'displayName',
      greeting: 'firstMessage',
      description: 'desc',
      replaceGlobalNote: 'replaceGlobalNote',
      alternateGreetings: 'alternateGreetings',
      backgroundEmbedding: 'backgroundHTML',
    } as const

    const patch: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(data)) {
      if (fieldRemap[field as keyof typeof fieldRemap]) {
        const realField = fieldRemap[field as keyof typeof fieldRemap]
        patch[realField] = value
      } else {
        return [
          {
            type: 'text',
            text: `Error: Field ${field} does not exist on character ${liveChar.chaId} or it isn't allowed to be modified.`,
          },
        ]
      }
    }
    if (canUseServerCommands()) {
      // A field patch touches one character row, so its rollback needs only
      // that row, not a deep clone of the whole characters array.
      const index = charactersResourceState.characters.indexOf(liveChar)
      const acceptedPatch = sanitizeCharacterPatch(patch)
      if (index >= 0) {
        const previous = currentCharacterRowSnapshot(index)
        applyCharacterInfoPatchOptimistically(characterId, acceptedPatch)
        dispatchUpdateCharacterScoped(characterId, acceptedPatch, previous)
      }
    } else {
      for (const [field, value] of Object.entries(patch)) {
        // @ts-ignore
        liveChar[field] = value
      }
    }

    return [
      {
        type: 'text',
        text: `Successfully updated character ${characterAccessName(liveChar)}`,
      },
    ]
  }

  async setCharacterLorebook(
    id: string,
    name: string,
    content?: string,
    keys?: string[],
    newName?: string,
    alwaysActive?: boolean,
  ): Promise<RPCToolCallContent[]> {
    const detailOwner = getDetailCharacterOwner(id)
    const detailChar = detailOwner instanceof Promise ? await detailOwner : detailOwner
    if (!detailChar) {
      return [
        {
          type: 'text',
          text: `Error: Character with ID ${id} not found.`,
        },
      ]
    }
    const lorebookOwner = getLorebookCharacterOwner(detailChar)
    const char = lorebookOwner instanceof Promise ? await lorebookOwner : lorebookOwner
    if (!char) return characterLorebookNotReadyResponse(detailChar)
    if (
      !(await this.promptAccess(
        'risu-set-character-lorebook',
        `add/modify character (${characterAccessName(char)}) global lorebook (${name})`,
      ))
    ) {
      return [
        {
          type: 'text',
          text: 'Access denied by user.',
        },
      ]
    }
    const staleTargetResponse = characterMutationTargetChangedResponse(id, char)
    if (staleTargetResponse) return staleTargetResponse

    const entries = cloneJsonValue(char.globalLore ?? [])
    const entryIndex = entries.findIndex((entry) => {
      const displayName = entry.comment || 'Unnamed ' + pickHashRand(5515, entry.content)
      return displayName === name
    })
    if (entryIndex === -1) {
      const newEntry: loreBook = {
        id: createNonSecurityUuid(),
        key: alwaysActive ? '' : keys?.join(',') || '',
        content: content || '',
        comment: newName || name,
        alwaysActive: alwaysActive || false,
        secondkey: '',
        selective: false,
        insertorder: 100,
        mode: 'normal',
      }
      entries.push(newEntry)
      if (canUseServerCommands()) {
        if (!replaceCharacterLorebooksThroughServerBridge(char.chaId, entries)) {
          return characterLorebookNotReadyResponse(char)
        }
      } else {
        char.globalLore = entries
      }
      return [
        {
          type: 'text',
          text: `Successfully added lorebook entry "${newName || name}" to character ${characterAccessName(char)}`,
        },
      ]
    }

    const entry = entries[entryIndex]

    if (content !== undefined) {
      entry.content = content
    }
    if (keys !== undefined) {
      entry.key = alwaysActive ? '' : keys.join(',')
    }
    if (newName !== undefined) {
      entry.comment = newName
    }
    if (alwaysActive !== undefined) {
      entry.alwaysActive = alwaysActive
      if (alwaysActive) {
        entry.key = ''
      }
    }

    if (canUseServerCommands()) {
      if (!replaceCharacterLorebooksThroughServerBridge(char.chaId, entries)) {
        return characterLorebookNotReadyResponse(char)
      }
    } else {
      char.globalLore = entries
    }

    return [
      {
        type: 'text',
        text: `Successfully updated lorebook entry "${name}" for character ${characterAccessName(char)}`,
      },
    ]
  }

  async deleteCharacterLorebook(id: string, name: string): Promise<RPCToolCallContent[]> {
    const detailOwner = getDetailCharacterOwner(id)
    const detailChar = detailOwner instanceof Promise ? await detailOwner : detailOwner
    if (!detailChar) {
      return [
        {
          type: 'text',
          text: `Error: Character with ID ${id} not found.`,
        },
      ]
    }
    const lorebookOwner = getLorebookCharacterOwner(detailChar)
    const char = lorebookOwner instanceof Promise ? await lorebookOwner : lorebookOwner
    if (!char) return characterLorebookNotReadyResponse(detailChar)
    if (
      !(await this.promptAccess(
        'risu-delete-character-lorebook',
        `delete character (${characterAccessName(char)}) global lorebook (${name})`,
      ))
    ) {
      return [
        {
          type: 'text',
          text: 'Access denied by user.',
        },
      ]
    }
    const staleTargetResponse = characterMutationTargetChangedResponse(id, char)
    if (staleTargetResponse) return staleTargetResponse

    const entries = cloneJsonValue(char.globalLore ?? [])
    const entryIndex = entries.findIndex((entry) => {
      const displayName = entry.comment || 'Unnamed ' + pickHashRand(5515, entry.content)
      return displayName === name
    })
    if (entryIndex === -1) {
      return [
        {
          type: 'text',
          text: `Error: Lorebook entry with name "${name}" not found.`,
        },
      ]
    }

    entries.splice(entryIndex, 1)
    if (canUseServerCommands()) {
      if (!replaceCharacterLorebooksThroughServerBridge(char.chaId, entries)) {
        return characterLorebookNotReadyResponse(char)
      }
    } else {
      char.globalLore = entries
    }

    return [
      {
        type: 'text',
        text: `Successfully deleted lorebook entry "${name}" from character ${characterAccessName(char)}`,
      },
    ]
  }

  async getCharacterRegexScripts(id: string): Promise<RPCToolCallContent[]> {
    const characterOwner = getDetailCharacterOwner(id)
    const char = characterOwner instanceof Promise ? await characterOwner : characterOwner
    if (!char) {
      return [
        {
          type: 'text',
          text: `Error: Character with ID ${id} not found.`,
        },
      ]
    }

    const organized = (char.customscript || []).map((script) => {
      return {
        comment: script.comment || 'Unnamed ' + pickHashRand(5515, script.in + script.out),
        in: script.in,
        out: script.out,
        type: script.type,
        flag: script.flag,
        ableFlag: script.ableFlag,
      }
    })

    return [
      {
        type: 'text',
        text: JSON.stringify(organized),
      },
    ]
  }

  async setCharacterRegexScripts(
    id: string,
    name: string,
    newName?: string,
    regexIn?: string,
    regexOut?: string,
    type?: string,
    flag?: string,
    ableFlag?: boolean,
  ): Promise<RPCToolCallContent[]> {
    const characterOwner = getDetailCharacterOwner(id)
    const char = characterOwner instanceof Promise ? await characterOwner : characterOwner
    if (!char) {
      return [
        {
          type: 'text',
          text: `Error: Character with ID ${id} not found.`,
        },
      ]
    }

    if (
      !(await this.promptAccess(
        'risu-set-character-regex-scripts',
        `add/modify character (${characterAccessName(char)}) regex script (${name})`,
      ))
    ) {
      return [
        {
          type: 'text',
          text: 'Access denied by user.',
        },
      ]
    }
    const staleTargetResponse = characterMutationTargetChangedResponse(id, char)
    if (staleTargetResponse) return staleTargetResponse

    const hadScriptsField = Object.prototype.hasOwnProperty.call(char, 'customscript')
    const previousScripts = cloneJsonValue(char.customscript ?? [])
    const previous = canUseServerCommands()
      ? {
          kind: 'characterScripts' as const,
          characterId: char.chaId,
          scripts: previousScripts,
          hadScriptsField,
        }
      : null
    const scripts = cloneJsonValue(previousScripts)

    const scriptIndex = scripts.findIndex((script) => {
      const displayName = script.comment || 'Unnamed ' + pickHashRand(5515, script.in + script.out)
      return displayName === name
    })
    if (scriptIndex === -1) {
      const newScript = {
        comment: newName || name,
        in: regexIn || '',
        out: regexOut || '',
        type: type || 'editdisplay',
        flag: flag || '',
        ableFlag: ableFlag !== undefined ? ableFlag : true,
      }

      scripts.push(newScript)
      if (previous) {
        ensureClientScriptDefinitionIds(scripts)
        replaceCharacterRegexScriptsOptimistically(char.chaId, scripts)
        dispatchReplaceCharacterScripts(char.chaId, scripts, previous, 0)
      } else {
        char.customscript = scripts
      }
      return [
        {
          type: 'text',
          text: `Successfully added regex script "${newName || name}" to character ${characterAccessName(char)}`,
        },
      ]
    }

    const script = scripts[scriptIndex]

    if (newName !== undefined) script.comment = newName
    if (regexIn !== undefined) script.in = regexIn
    if (regexOut !== undefined) script.out = regexOut
    if (type !== undefined) script.type = type
    if (flag !== undefined) script.flag = flag
    if (ableFlag !== undefined) script.ableFlag = ableFlag
    if (previous) {
      ensureClientScriptDefinitionIds(scripts)
      replaceCharacterRegexScriptsOptimistically(char.chaId, scripts)
      dispatchReplaceCharacterScripts(char.chaId, scripts, previous, 0)
    } else {
      char.customscript = scripts
    }

    return [
      {
        type: 'text',
        text: `Successfully updated regex script "${name}" for character ${characterAccessName(char)}`,
      },
    ]
  }

  async deleteCharacterRegexScripts(id: string, name: string): Promise<RPCToolCallContent[]> {
    const characterOwner = getDetailCharacterOwner(id)
    const char = characterOwner instanceof Promise ? await characterOwner : characterOwner
    if (!char) {
      return [
        {
          type: 'text',
          text: `Error: Character with ID ${id} not found.`,
        },
      ]
    }

    if (
      !(await this.promptAccess(
        'risu-delete-character-regex-scripts',
        `delete character (${characterAccessName(char)}) regex script (${name})`,
      ))
    ) {
      return [
        {
          type: 'text',
          text: 'Access denied by user.',
        },
      ]
    }
    const staleTargetResponse = characterMutationTargetChangedResponse(id, char)
    if (staleTargetResponse) return staleTargetResponse

    const hadScriptsField = Object.prototype.hasOwnProperty.call(char, 'customscript')
    const previousScripts = cloneJsonValue(char.customscript ?? [])
    const previous = canUseServerCommands()
      ? {
          kind: 'characterScripts' as const,
          characterId: char.chaId,
          scripts: previousScripts,
          hadScriptsField,
        }
      : null
    const scripts = cloneJsonValue(previousScripts)

    const scriptIndex = scripts.findIndex((script) => {
      const displayName = script.comment || 'Unnamed ' + pickHashRand(5515, script.in + script.out)
      return displayName === name
    })
    if (scriptIndex === -1) {
      return [
        {
          type: 'text',
          text: `Error: Regex script with name "${name}" not found.`,
        },
      ]
    }

    scripts.splice(scriptIndex, 1)
    if (previous) {
      ensureClientScriptDefinitionIds(scripts)
      replaceCharacterRegexScriptsOptimistically(char.chaId, scripts)
      dispatchReplaceCharacterScripts(char.chaId, scripts, previous, 0)
    } else {
      char.customscript = scripts
    }

    return [
      {
        type: 'text',
        text: `Successfully deleted regex script "${name}" from character ${characterAccessName(char)}`,
      },
    ]
  }

  async getCharacterAdditionalAssets(id: string): Promise<RPCToolCallContent[]> {
    const characterOwner = getDetailCharacterOwner(id)
    const char = characterOwner instanceof Promise ? await characterOwner : characterOwner
    if (!char) {
      return [
        {
          type: 'text',
          text: `Error: Character with ID ${id} not found.`,
        },
      ]
    }

    const assets = (char.additionalAssets || []).map((asset) => ({
      name: asset[0] || 'Unnamed ' + pickHashRand(5515, asset[1] + asset[2]),
      path: asset[1],
      ext: asset[2],
    }))

    return [
      {
        type: 'text',
        text: JSON.stringify(assets),
      },
    ]
  }

  async deleteCharacterAdditionalAssets(id: string, assetName: string): Promise<RPCToolCallContent[]> {
    const characterOwner = getDetailCharacterOwner(id)
    const char = characterOwner instanceof Promise ? await characterOwner : characterOwner
    if (!char) {
      return [
        {
          type: 'text',
          text: `Error: Character with ID ${id} not found.`,
        },
      ]
    }
    if (canUseServerCommands()) return unsupportedServerBackedCharacterWrite('asset reference edits')

    if (
      !(await this.promptAccess(
        'risu-delete-character-additional-assets',
        `delete character (${characterAccessName(char)}) additional asset (${assetName})`,
      ))
    ) {
      return [
        {
          type: 'text',
          text: 'Access denied by user.',
        },
      ]
    }

    if (!char.additionalAssets) {
      char.additionalAssets = []
    }

    const assetIndex = char.additionalAssets.findIndex((asset) => {
      const displayName = asset[0] || 'Unnamed ' + pickHashRand(5515, asset[1] + asset[2])
      return displayName === assetName
    })
    if (assetIndex === -1) {
      return [
        {
          type: 'text',
          text: `Error: Additional asset with name "${assetName}" not found.`,
        },
      ]
    }

    char.additionalAssets.splice(assetIndex, 1)

    return [
      {
        type: 'text',
        text: `Successfully deleted additional asset "${assetName}" from character ${characterAccessName(char)}`,
      },
    ]
  }

  async getCharacterLuaScript(id: string): Promise<RPCToolCallContent[]> {
    const characterOwner = getDetailCharacterOwner(id)
    const char = characterOwner instanceof Promise ? await characterOwner : characterOwner
    if (!char) {
      return [
        {
          type: 'text',
          text: `Error: Character with ID ${id} not found.`,
        },
      ]
    }

    const firstTrigger = char.triggerscript?.[0]
    if (firstTrigger?.effect?.[0]?.type === 'triggerlua' && firstTrigger.effect[0].code.trim().length > 0) {
      return [
        {
          type: 'text',
          text: firstTrigger.effect[0].code,
        },
      ]
    }

    return [
      {
        type: 'text',
        text: 'Error: This character does not contain a Lua trigger as the first trigger.',
      },
    ]
  }

  async setCharacterLuaScript(id: string, code: string): Promise<RPCToolCallContent[]> {
    const characterOwner = getDetailCharacterOwner(id)
    const char = characterOwner instanceof Promise ? await characterOwner : characterOwner
    if (!char) {
      return [
        {
          type: 'text',
          text: `Error: Character with ID ${id} not found.`,
        },
      ]
    }

    if (
      !(await this.promptAccess(
        'risu-set-character-lua-script',
        `modify character (${characterAccessName(char)}) lua script`,
      ))
    ) {
      return [
        {
          type: 'text',
          text: 'Access denied by user.',
        },
      ]
    }
    const staleTargetResponse = characterMutationTargetChangedResponse(id, char)
    if (staleTargetResponse) return staleTargetResponse

    const hadTriggersField = Object.prototype.hasOwnProperty.call(char, 'triggerscript')
    const previousTriggers = cloneJsonValue(char.triggerscript ?? [])
    const previous = canUseServerCommands()
      ? {
          kind: 'characterTriggers' as const,
          characterId: char.chaId,
          triggers: previousTriggers,
          hadTriggersField,
        }
      : null
    const triggers = cloneJsonValue(previousTriggers)
    const firstTrigger = triggers[0]
    if (firstTrigger?.effect?.[0]?.type === 'triggerlua') {
      firstTrigger.effect[0].code = code
      if (previous) {
        ensureClientTriggerDefinitionIds(triggers)
        replaceCharacterTriggersOptimistically(char.chaId, triggers)
        dispatchReplaceCharacterTriggers(char.chaId, triggers, previous, 0)
      } else {
        char.triggerscript = triggers
      }
      return [
        {
          type: 'text',
          text: `Successfully updated Lua script for character ${characterAccessName(char)}`,
        },
      ]
    }

    return [
      {
        type: 'text',
        text: 'Error: User must first change the first trigger type to Lua manually.',
      },
    ]
  }

  async listCharacters(count: number = 100, offset: number = 0): Promise<RPCToolCallContent[]> {
    if (count > 100) count = 100
    if (count < 1) count = 1
    if (offset < 0) offset = 0

    const characters = (charactersResourceState.status === 'ready' ? charactersResourceState.characters : [])
      .slice(offset, offset + count)
      .map((char) => ({
        id: char.chaId,
        name: char.name || 'Unnamed',
        displayName: getCharacterDisplayName(char, char.name || char.chaId || 'Unnamed'),
        type: char.type,
      }))

    return [
      {
        type: 'text',
        text: JSON.stringify(characters),
      },
    ]
  }
}

function unsupportedServerBackedCharacterWrite(surface: string): RPCToolCallContent[] {
  return [
    {
      type: 'text',
      text: `Error: ${surface} are not supported in server-backed web mode yet.`,
    },
  ]
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function replaceCharacterLorebooksThroughServerBridge(characterId: string, entries: loreBook[]): boolean {
  if (lorebookStubsEnabled() && !isCharacterLorebookHydrated(characterId)) return false
  ensureClientLorebookEntryIds(entries)
  return replaceCharacterLorebookCollectionFull(characterId, entries, 0)
}

function characterLorebookNotReadyResponse(char: character): RPCToolCallContent[] {
  return [
    {
      type: 'text',
      text: `Error: Character lorebooks for ${characterAccessName(char)} are not hydrated yet; open or hydrate this character's lorebook before editing it.`,
    },
  ]
}

function characterAccessName(char: character): string {
  return getCharacterDisplayName(char, char.chaId || 'Unnamed')
}

function characterMutationTargetChangedResponse(id: string, original: character): RPCToolCallContent[] | null {
  const live = getCharacterResourceOwner(original.chaId)
  if (!live) {
    return [
      {
        type: 'text',
        text: `Error: Character with ID ${id} not found.`,
      },
    ]
  }
  if (live !== original) {
    return [
      {
        type: 'text',
        text: `Error: Character with ID ${id} changed before access was accepted. Please retry.`,
      },
    ]
  }
  return null
}

function applyCharacterInfoPatchOptimistically(characterId: string, patch: Record<string, unknown>): void {
  if (Object.keys(patch).length === 0) return
  const target = getCharacterResourceOwner(characterId)
  if (!target) return
  const mutableTarget = target as unknown as Record<string, unknown>
  for (const [field, value] of Object.entries(patch)) {
    mutableTarget[field] = value
  }
}

function replaceCharacterRegexScriptsOptimistically(characterId: string, scripts: character['customscript']): void {
  const target = getCharacterResourceOwner(characterId)
  if (target) target.customscript = scripts
}

function replaceCharacterTriggersOptimistically(characterId: string, triggers: character['triggerscript']): void {
  const target = getCharacterResourceOwner(characterId)
  if (target) target.triggerscript = triggers
}

function getDetailCharacterOwner(id: string): character | Promise<character | undefined> | undefined {
  const initial = getCharacter(id)
  if (!initial?.chaId) return undefined

  const characterId = initial.chaId
  if (!isServerCharacterShell(initial)) return getCharacterResourceOwner(characterId)

  return hydrateCharacterShell(characterId).then(() => {
    const owner = getCharacterResourceOwner(characterId)
    return owner && !isServerCharacterShell(owner) ? owner : undefined
  })
}

function getLorebookCharacterOwner(character: character): character | Promise<character | undefined> | undefined {
  const characterId = character.chaId
  const owner = getCharacterResourceOwner(characterId)
  if (!owner) return undefined
  if (!lorebookStubsEnabled() || isCharacterLorebookHydrated(characterId)) return owner
  return ensureCharacterLorebookHydrated(characterId).then((hydrated) => {
    if (!hydrated) return undefined
    const hydratedOwner = getCharacterResourceOwner(characterId)
    return hydratedOwner && !isServerCharacterShell(hydratedOwner) ? hydratedOwner : undefined
  })
}

function lorebookStubsEnabled(): boolean {
  return (settingsResourceState.value as Record<string, unknown>).enableLorebookStubs === true
}
