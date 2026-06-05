/**
 * True when `risuChatParser` provably returns `text` unchanged.
 *
 * The parser rewrites only when it sees a `{` opener (`{{...}}`, `{#...#}`,
 * legacy blocks) or one of the legacy speaker tags. A row without those
 * markers is byte-identical after parsing and cannot read/write chat vars.
 */
export function isRisuChatParserFixedPoint(text: string): boolean {
  return !text.includes('{') && !/<(user|char|bot)>/i.test(text)
}
