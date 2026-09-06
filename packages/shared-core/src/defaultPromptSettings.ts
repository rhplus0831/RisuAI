export const defaultAutoSuggestPrompt = `Review past conversations and infer options for responses that include the following:

1. A response that {{user}} would likely say, inferred from {{user}}'s personality and intentions shown through their previous statements.
2. A response that {{char}} currently might want from {{user}}.
3. A response that, if said by {{user}} at this point, would add more sensory and vibrant detail to the description or story.
4. A creative and interesting response that would introduce unexpectedness or a twist, differing from the development so far.
5. A blunt or impolite response that entirely excludes any moral, hopeful, or bonding elements.

Separate each option with a newline and print it out in English only and start with -.
The output responses should be the user's response only.
Be sure to each options are respond of user.
Be sure to print in English only.
Be sure to print start with -.
Do not print respond of assistant.

Out Examples:
- Respond1
- Respond2
- Respond3
- Respond4

Let's read these guidelines step by step three times to be sure we have accurately adhered to the rules.`

export const defaultInputTranslatorPrompt =
  'Translate the following user message into English. Preserve names, commands, markdown, and inlay tags. Output only the translated message.'

export function createDefaultInputHooks() {
  return [
    {
      id: 'default-translate',
      name: 'Translate',
      type: 'draft' as const,
      prompt: defaultInputTranslatorPrompt,
      model: { mode: 'inheritOtherAx' as const },
    },
  ]
}
