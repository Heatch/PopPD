import { shell } from "electron"

/** Electron-native open/reveal: no shell string interpolation, so filenames cannot inject. */
export async function openPath(target: string): Promise<void> {
  await shell.openPath(target)
}

export function showInFolder(target: string): void {
  shell.showItemInFolder(target)
}

export async function openExternal(url: string): Promise<void> {
  if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
}
