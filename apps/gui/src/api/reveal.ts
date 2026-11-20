import { invoke, isTauri } from '@tauri-apps/api/core'

/**
 * Show a file or folder of this computer in its file manager (Explorer, Finder, or the default
 * one on Linux). The path must be absolute and exist. Rejects with the reason.
 */
export async function revealInExplorer(path: string): Promise<void> {
  if (isTauri()) await invoke('reveal_in_explorer', { path })
}
