import type { SettingItem } from './types'

export const contextAgentSettingsItems: SettingItem[] = [
  {
    type: 'header',
    id: 'contextAgent.header',
    labelKey: 'agentContextEnabled',
    options: { level: 'h2' },
  },
  {
    id: 'contextAgent.enabled',
    type: 'check',
    labelKey: 'agentContextEnabled',
    bindKey: 'agentContextEnabled',
    helpKey: 'agentContext',
  },
  {
    id: 'contextAgent.prompt',
    type: 'textarea',
    labelKey: 'agentContextPrompt',
    bindKey: 'agentContextPrompt',
    helpKey: 'agentContextPrompt',
    condition: (ctx) => ctx.db.agentContextEnabled === true,
    options: {
      placeholder:
        'Use the available tools to find only information relevant to the next response. Return concise context for {{agent}}.',
    },
  },
  {
    id: 'contextAgent.maxOutput',
    type: 'number',
    labelKey: 'agentContextMaxOutput',
    bindKey: 'agentContextMaxOutput',
    helpKey: 'agentContextMaxOutput',
    condition: (ctx) => ctx.db.agentContextEnabled === true,
    options: { min: 0, max: 12000 },
  },
  {
    id: 'contextAgent.maxToolRounds',
    type: 'number',
    labelKey: 'agentContextMaxToolRounds',
    bindKey: 'agentContextMaxToolRounds',
    helpKey: 'agentContextMaxToolRounds',
    condition: (ctx) => ctx.db.agentContextEnabled === true,
    options: { min: 0, max: 12 },
  },
]
