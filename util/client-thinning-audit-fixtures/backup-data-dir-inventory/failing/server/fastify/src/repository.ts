export const KNOWN_DATA_DIR_CHILDREN = ['db.json', 'assets', 'secrets'] as const

export function createBackup(): void {
  const copied = ['db.json', 'assets']
  void copied
}

export function restoreBackup(): void {
  const restored = ['db.json', 'assets']
  void restored
}
