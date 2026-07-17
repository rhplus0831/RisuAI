export function reconcileLegacyGuiSubmenu(useLegacyGUI: boolean, submenu: number, defaultSubmenu = 0): number {
  if (useLegacyGUI) return -1
  return submenu === -1 ? defaultSubmenu : submenu
}
