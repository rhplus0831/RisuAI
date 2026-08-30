export type ChatMLRole = 'system' | 'user' | 'assistant'

export interface ChatMLRow {
  role: ChatMLRole
  content: string
  thoughts: string[]
}

/**
 * Parse RisuAI's ChatML syntax without expanding CBS or other prompt variables.
 * Callers can transform each row after its role boundary has been established so
 * substituted content cannot inject additional messages.
 */
export function parseChatMLRows(
  data: string,
  transformContent: (content: string) => string = identity,
): ChatMLRow[] | null {
  const starter = '<|im_start|>'
  const separator = '<|im_sep|>'
  const ender = '<|im_end|>'

  const trimmedData = data.trim()
  if (!trimmedData.startsWith(starter)) return null

  return trimmedData
    .split(starter)
    .filter((value) => value !== '')
    .map((value) => {
      let role: ChatMLRole = 'user'
      if (value.startsWith('user' + separator)) {
        role = 'user'
        value = value.substring(4 + separator.length)
      } else if (value.startsWith('system' + separator)) {
        role = 'system'
        value = value.substring(6 + separator.length)
      } else if (value.startsWith('assistant' + separator)) {
        role = 'assistant'
        value = value.substring(9 + separator.length)
      } else if (value.startsWith('user ') || value.startsWith('user\n')) {
        role = 'user'
        value = value.substring(5)
      } else if (value.startsWith('system ') || value.startsWith('system\n')) {
        role = 'system'
        value = value.substring(7)
      } else if (value.startsWith('assistant ') || value.startsWith('assistant\n')) {
        role = 'assistant'
        value = value.substring(10)
      }

      value = value.trim()
      if (value.endsWith(ender)) value = value.substring(0, value.length - ender.length)

      const thoughts: string[] = []
      value = value.replace(/<Thoughts>(.+)<\/Thoughts>/gms, (_match, body: string) => {
        thoughts.push(body)
        return ''
      })

      return {
        role,
        content: transformContent(value),
        thoughts,
      }
    })
}

function identity(value: string): string {
  return value
}
