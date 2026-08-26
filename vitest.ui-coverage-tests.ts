// Keep this inventory aligned with the files selected by the coverage:ui-map
// package script. The ordinary frontend lane excludes them only when that
// coverage lane is guaranteed to execute them.
export const uiCoverageTestFiles = [
  'src/lib/Others/GridCatalog.svelte.test.ts',
  'src/lib/Others/ChatList.svelte.test.ts',
  'src/lib/SideBars/SideChatList.svelte.test.ts',
  'src/lib/SideBars/Sidebar.charList.test.ts',
  'src/lib/ChatScreens/ChatBody.svelte.test.ts',
  'src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts',
] as const

export const excludeUiCoverageTests = process.env.RISU_TEST_EXCLUDE_UI_MAP === 'true'
