import fc from 'fast-check'
import { withTestDatabaseWrite } from 'src/ts/__tests__/resourceDatabaseState'

export const cbs = (op: string, ...args: string[]): string =>
  `{{${op}${args.length > 0 ? '::' : ''}${args.join('::')}}}`

/**
 * Resets globalChatVariables and its default values,
 * as well as each character's all scriptstates and their default values.
 */
export const resetChatVariables = (): void => {
  withTestDatabaseWrite((database) => {
    for (const char of database.characters) {
      for (const chat of char.chats) {
        chat.scriptstate = {}
      }
      char.defaultVariables = ''
    }

    database.globalChatVariables = {}
    database.templateDefaultVariables = ''
  })
}

export const trimVarPrefix = (key: unknown): string => {
  if (typeof key !== 'string') {
    return 'null'
  }

  if (key.startsWith('$')) {
    return key.slice(1)
  }

  if (key.startsWith('toggle_')) {
    return key.slice('toggle_'.length)
  }

  return 'null'
}

/** No hashes, colons, curly braces, line breaks */
export const validCBSArgRegExp = /^[^#:{}\r\n]+$/
/** {@link validCBSArgRegExp `validCBSArgRegExp`} */
export const validCBSArgProp = fc.oneof(
  fc.stringMatching(validCBSArgRegExp),
  fc.string({ unit: 'grapheme' }).filter((s) => validCBSArgRegExp.test(s)),
)
