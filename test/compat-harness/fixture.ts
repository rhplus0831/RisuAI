import type { CompatScenario, CompatTransport } from './types'

export const FIXTURE_CHARACTER_ID = 'compat-char'
export const FIXTURE_CHAT_ID = 'compat-chat'
export const FIXTURE_USER_ID = 'fixture-user-1'
export const FIXTURE_ASSISTANT_ID = 'fixture-assistant-1'
export const MOCK_OPENAI_KEY = 'compat-openai-key'

export interface FixtureMessage {
  role: 'user' | 'char'
  data: string
  chatId: string
  time: number
  saying?: string
}

export function initialMessages(): FixtureMessage[] {
  return [
    {
      role: 'user',
      data: 'Seed question.',
      chatId: FIXTURE_USER_ID,
      time: 0,
    },
    {
      role: 'char',
      data: 'Seed answer.',
      chatId: FIXTURE_ASSISTANT_ID,
      saying: FIXTURE_CHARACTER_ID,
      time: 0,
    },
  ]
}

export function createFixtureDatabase(transport: CompatTransport, useSayNothing: boolean): Record<string, unknown> {
  return {
    apiType: 'openai',
    aiModel: 'gpt4o',
    subModel: 'gpt4o',
    openAIKey: MOCK_OPENAI_KEY,
    usePlainFetch: true,
    useStreaming: transport === 'streamed',
    halfStreaming: false,
    useSayNothing,
    maxContext: 4000,
    maxResponse: 96,
    temperature: 70,
    top_p: 1,
    frequencyPenalty: 0,
    PresensePenalty: 0,
    genTime: 1,
    requestRetrys: 0,
    promptTemplate: null,
    username: '<user>',
    characters: [
      {
        type: 'character',
        name: 'Compat Character',
        firstMessage: '',
        desc: 'A deterministic compatibility-test character.',
        notes: '',
        chatPage: 0,
        viewScreen: 'none',
        inlayViewScreen: false,
        bias: [],
        emotionImages: [],
        globalLore: [],
        chaId: FIXTURE_CHARACTER_ID,
        sdData: [],
        customscript: [],
        triggerscript: [],
        utilityBot: false,
        exampleMessage: '',
        creatorNotes: '',
        systemPrompt: '',
        postHistoryInstructions: '',
        alternateGreetings: [],
        tags: [],
        creator: '',
        characterVersion: '',
        personality: '',
        scenario: '',
        firstMsgIndex: -1,
        replaceGlobalNote: '',
        additionalText: '',
        chatFolders: [],
        chats: [
          {
            id: FIXTURE_CHAT_ID,
            name: 'main',
            note: '',
            localLore: [],
            scriptstate: {},
            fmIndex: -1,
            message: initialMessages(),
          },
        ],
      },
    ],
  }
}

export function providerReply(scenario: CompatScenario, callIndex: number): string {
  switch (scenario) {
    case 'send':
      return 'Empty-send reply.'
    case 'regenerate':
      return 'Regenerated reply.'
    case 'continue':
      return ' Continued reply.'
    case 'multisend':
      return `Multisend reply ${callIndex + 1}.`
  }
}

export const MULTISEND_COMMAND = '/multisend First multisend turn.|||Second multisend turn.'

export function splitStreamingReply(reply: string): string[] {
  const pivot = Math.max(1, Math.floor(reply.length / 2))
  return [reply.slice(0, pivot), reply.slice(pivot)].filter((part) => part.length > 0)
}
