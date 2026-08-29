export const PHASE9_BASELINE_DRIFT_FIXTURES = {
  groupCharacter: {
    input: '{{char}}',
    baselineExpected: 'Member',
    currentExpected: 'Legacy Group',
  },
  historyWindow: {
    input: '{{history::2}}',
    messages: ['oldest', 'middle', 'newest'],
    baselineExpected: ['oldest', 'middle', 'newest'],
    currentExpected: ['middle', 'newest'],
  },
  reverse: {
    input: '{{reverse::abc}}',
    baselineExpected: 'cba::esrever',
    currentExpected: 'cba',
  },
  missingFirstMessageIndex: {
    input: '{{firstmsgindex}}',
    expected: '{{firstmsgindex}}',
  },
  metadata: {
    input: '{{metadata::local}}|{{metadata::node}}|{{metadata::fastify}}|{{metadata::risutype}}|{{metadata::language}}',
    baselineExpected: '0|0|Error: fastify is not a valid metadata key.|web|ko',
    currentExpected: '0|0|1|fastify|ko',
  },
  standaloneSlot: {
    input: '{{slot::phase9}}',
    baselineExpected: '{{slot::phase9}}',
    currentExpected: 'slot-value',
  },
} as const

export const PHASE9_OVER_BUDGET_EACH_COUNT = 4097

export function phase9OverBudgetEachInput(): string {
  return `{{#each::keep ${JSON.stringify(Array(PHASE9_OVER_BUDGET_EACH_COUNT).fill(1))} as n}}{{slot::n}}{{/}}`
}

export function phase9DriftCharacter(name = 'Member', chaId = 'member') {
  return {
    type: 'character',
    chaId,
    name,
    nickname: '',
    chatPage: 0,
    chats: [phase9DriftChat()],
    firstMessage: '',
    alternateGreetings: [],
    personality: '',
    desc: '',
    scenario: '',
    exampleMessage: '',
    globalLore: [],
    defaultVariables: '',
  }
}

export function phase9DriftChat(messages: readonly string[] = []) {
  return {
    name: 'main',
    message: messages.map((data, index) => ({
      role: index % 2 === 0 ? 'user' : 'char',
      data,
    })),
    note: '',
    localLore: [],
    scriptstate: {},
  }
}

export function phase9DriftGroup(memberId = 'member') {
  return {
    type: 'group',
    chaId: 'legacy-group',
    name: 'Legacy Group',
    chatPage: 0,
    chats: [
      {
        ...phase9DriftChat(),
        message: [{ role: 'char', data: 'last group reply', saying: memberId }],
      },
    ],
    defaultVariables: '',
  }
}

export function phase9DriftDatabase(characters: unknown[]) {
  return {
    currentChar: 0,
    characters,
    username: 'User',
    personaPrompt: '',
    language: 'ko',
    aiModel: 'gpt35',
    maxContext: 4096,
    globalChatVariables: {},
    templateDefaultVariables: '',
  }
}
