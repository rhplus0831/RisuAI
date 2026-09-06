const replacements = [
  '{', //0xE9B8
  '}', //0xE9B9
  '(', //0xE9BA
  ')', //0xE9BB
  '&lt;', //0xE9BC
  '&gt;', //0xE9BD
  ':', //0xE9BE
  ';', //0xE9BF
]

export type CbsConditions = {
  firstmsg?: boolean
  chatRole?: string
}

export type blockMatch =
  | 'ignore'
  | 'parse'
  | 'nothing'
  | 'ifpure'
  | 'pure'
  | 'each'
  | 'function'
  | 'pure-display'
  | 'normalize'
  | 'escape'
  | 'newif'
  | 'newif-falsy'

export function risuUnescape(text: string) {
  return text.replace(/[\uE9b8-\uE9bf]/g, (f) => {
    const index = f.charCodeAt(0) - 0xe9b8
    return replacements[index]
  })
}

export function risuEscape(text: string) {
  return text.replace(/[{}()]/g, (f) => {
    switch (f) {
      case '{':
        return '\uE9B8'
      case '}':
        return '\uE9B9'
      case '(':
        return '\uE9BA'
      case ')':
        return '\uE9BB'
      default:
        return f
    }
  })
}

export const dateTimeFormat = (main: string, time = 0) => {
  const date = time === 0 ? new Date() : new Date(time)
  if (!main) {
    return ''
  }
  if (main.startsWith(':')) {
    main = main.substring(1)
  }
  if (main.length > 300) {
    return ''
  }
  return main
    .replace(/YYYY/g, date.getFullYear().toString())
    .replace(/YY/g, date.getFullYear().toString().substring(2))
    .replace(/MMMM/g, Intl.DateTimeFormat('en', { month: 'long' }).format(date))
    .replace(/MMM/g, Intl.DateTimeFormat('en', { month: 'short' }).format(date))
    .replace(/MM/g, (date.getMonth() + 1).toString().padStart(2, '0'))
    .replace(
      /DDDD/g,
      Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24)).toString(),
    )
    .replace(/DD/g, date.getDate().toString().padStart(2, '0'))
    .replace(/dddd/g, Intl.DateTimeFormat('en', { weekday: 'long' }).format(date))
    .replace(/ddd/g, Intl.DateTimeFormat('en', { weekday: 'short' }).format(date))
    .replace(/HH/g, date.getHours().toString().padStart(2, '0'))
    .replace(/hh/g, (date.getHours() % 12 || 12).toString().padStart(2, '0'))
    .replace(/mm/g, date.getMinutes().toString().padStart(2, '0'))
    .replace(/ss/g, date.getSeconds().toString().padStart(2, '0'))
    .replace(/X/g, Math.floor(date.getTime() / 1000).toString())
    .replace(/x/g, date.getTime().toString())
    .replace(/A/g, date.getHours() >= 12 ? 'PM' : 'AM')
}

export const legacyBlockMatcher = (p1: string, _matcherArg: unknown) => {
  const bn = p1.indexOf('\n')

  if (bn === -1) {
    return null
  }

  const logic = p1.substring(0, bn)
  const content = p1.substring(bn + 1)
  const statement = logic.split(' ', 2)

  switch (statement[0]) {
    case 'if': {
      if (['', '0', '-1'].includes(statement[1])) {
        return ''
      }

      return content.trim()
    }
  }

  return null
}

export function parseArray(p1: string): unknown[] {
  try {
    const arr = JSON.parse(p1)
    if (Array.isArray(arr)) {
      return arr
    }
    return p1.split('§')
  } catch (error) {
    return p1.split('§')
  }
}

export function parseDict(p1: string): { [key: string]: unknown } {
  try {
    return JSON.parse(p1)
  } catch (error) {
    return {}
  }
}

export function makeArray(p1: unknown[]): string {
  return JSON.stringify(
    p1.map((f) => {
      if (typeof f === 'string') {
        return f.replace(/::/g, '\\u003A\\u003A')
      }
      return f
    }),
  )
}

export function trimLines(p1: string) {
  return p1
    .split('\n')
    .map((v) => {
      return v.trimStart()
    })
    .join('\n')
    .trim()
}
