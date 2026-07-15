export const pluginAlertModalStore = $state({
  open: false,
  errors: [] as Array<{
    message: string
    userAlertKey: string
  }>,
})
