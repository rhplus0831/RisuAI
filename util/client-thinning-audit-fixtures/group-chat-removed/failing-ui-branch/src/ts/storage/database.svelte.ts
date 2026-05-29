// A4R-group-chat-removed fixture (failing-ui-branch): keep-layers intact so only the
// negative half (UI branch) fails.
interface Database {
  characters: ({ type?: string } | null)[]
}

export function setDatabase(data: Database) {
  data.characters = data.characters.filter((c) => (c as { type?: string } | null)?.type !== 'group')
}
