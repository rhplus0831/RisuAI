export interface CalculationVariableResolver {
  getChatVar(key: string): string
  getGlobalChatVar(key: string): string
}

type Operator = {
  precedence: number
  associativity: 'Left' | 'Right'
}

const operators: Record<string, Operator> = {
  '+': { precedence: 2, associativity: 'Left' },
  '-': { precedence: 2, associativity: 'Left' },
  '*': { precedence: 3, associativity: 'Left' },
  '/': { precedence: 3, associativity: 'Left' },
  '^': { precedence: 4, associativity: 'Left' },
  '%': { precedence: 3, associativity: 'Left' },
  '<': { precedence: 1, associativity: 'Left' },
  '>': { precedence: 1, associativity: 'Left' },
  '|': { precedence: 1, associativity: 'Left' },
  '&': { precedence: 1, associativity: 'Left' },
  '≤': { precedence: 1, associativity: 'Left' },
  '≥': { precedence: 1, associativity: 'Left' },
  '=': { precedence: 1, associativity: 'Left' },
  '≠': { precedence: 1, associativity: 'Left' },
  '!': { precedence: 5, associativity: 'Right' },
}

const operatorKeys = Object.keys(operators)

function toRPN(expression: string): string {
  let outputQueue = ''
  const operatorStack: string[] = []
  const expressionTokens: string[] = []

  expression = expression.replace(/\s+/g, '')
  let lastToken = ''

  for (let i = 0; i < expression.length; i++) {
    const char = expression[i]
    if (char === '-' && (i === 0 || operatorKeys.includes(expression[i - 1]) || expression[i - 1] === '(')) {
      lastToken += char
    } else if (operatorKeys.includes(char)) {
      if (lastToken !== '') {
        expressionTokens.push(lastToken)
      } else {
        expressionTokens.push('0')
      }
      lastToken = ''
      expressionTokens.push(char)
    } else {
      lastToken += char
    }
  }

  if (lastToken !== '') {
    expressionTokens.push(lastToken)
  } else {
    expressionTokens.push('0')
  }

  expressionTokens.forEach((token) => {
    if (parseFloat(token) || token === '0') {
      outputQueue += token + ' '
    } else if (operatorKeys.includes(token)) {
      while (
        operatorStack.length > 0 &&
        ((operators[token].associativity === 'Left' &&
          operators[token].precedence <= operators[operatorStack[operatorStack.length - 1]].precedence) ||
          (operators[token].associativity === 'Right' &&
            operators[token].precedence < operators[operatorStack[operatorStack.length - 1]].precedence))
      ) {
        outputQueue += operatorStack.pop() + ' '
      }

      operatorStack.push(token)
    }
  })

  while (operatorStack.length > 0) {
    outputQueue += operatorStack.pop() + ' '
  }

  return outputQueue.trim()
}

function calculateRPN(expression: string): number | undefined {
  const stack: number[] = []

  expression.split(' ').forEach((token) => {
    if (parseFloat(token) || token === '0') {
      stack.push(parseFloat(token))
    } else {
      const b = stack.pop() as number
      const a = stack.pop() as number
      switch (token) {
        case '+':
          stack.push(a + b)
          break
        case '-':
          stack.push(a - b)
          break
        case '*':
          stack.push(a * b)
          break
        case '/':
          stack.push(a / b)
          break
        case '^':
          stack.push(a ** b)
          break
        case '%':
          stack.push(a % b)
          break
        case '<':
          stack.push(a < b ? 1 : 0)
          break
        case '>':
          stack.push(a > b ? 1 : 0)
          break
        case '|':
          stack.push(a || b)
          break
        case '&':
          stack.push(a && b)
          break
        case '≤':
          stack.push(a <= b ? 1 : 0)
          break
        case '≥':
          stack.push(a >= b ? 1 : 0)
          break
        case '=':
          stack.push(a === b ? 1 : 0)
          break
        case '≠':
          stack.push(a !== b ? 1 : 0)
          break
        case '!':
          stack.push(b ? 0 : 1)
          break
      }
    }
  })

  if (stack.length === 0) {
    return 0
  }

  return stack.pop()
}

function executeRPNCalculation(text: string, variables: CalculationVariableResolver): number | undefined {
  text = text
    .replace(/\$([a-zA-Z0-9_]+)/g, (_, key: string) => {
      const parsed = parseFloat(variables.getChatVar(key))
      if (isNaN(parsed)) {
        return '0'
      }
      return parsed.toString()
    })
    .replace(/\@([a-zA-Z0-9_]+)/g, (_, key: string) => {
      const parsed = parseFloat(variables.getGlobalChatVar(key))
      if (isNaN(parsed)) {
        return '0'
      }
      return parsed.toString()
    })
    .replace(/&&/g, '&')
    .replace(/\|\|/g, '|')
    .replace(/<=/g, '≤')
    .replace(/>=/g, '≥')
    .replace(/==/g, '=')
    .replace(/!=/g, '≠')
    .replace(/null/gi, '0')
  const expression = toRPN(text)
  return calculateRPN(expression)
}

export function calculateString(text: string, variables: CalculationVariableResolver): number | undefined {
  const depthText: string[] = ['']

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') {
      depthText.push('')
    } else if (text[i] === ')' && depthText.length > 1) {
      const result = executeRPNCalculation(depthText.pop()!, variables)
      depthText[depthText.length - 1] += result
    } else {
      depthText[depthText.length - 1] += text[i]
    }
  }

  return executeRPNCalculation(depthText.join(''), variables)
}
