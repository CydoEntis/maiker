import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { z } from 'zod'

/** The agents the desktop app can install from its own list of commands. */
export type InstallableAgent = 'claude' | 'codex' | 'gemini' | 'opencode'

const InstalledSchema = z.object({ version: z.string().nullable() })
/** `version` is null when the install finished but the program was not found afterwards (a new terminal may see it). */
export type Installed = z.infer<typeof InstalledSchema>

/** The exact command an install will run on this computer, to show before it runs. */
export async function agentInstallCommand(agent: InstallableAgent): Promise<string> {
  if (!isTauri()) throw new Error('Installing an agent needs the desktop app.')
  return z.string().parse(await invoke<unknown>('agent_install_command', { agent }))
}

/**
 * Install an agent with its documented command, then read its version. Output arrives on
 * `listenInstallProgress` while it runs. Rejects with the real reason; only one install runs at a time.
 */
export async function installAgent(agent: InstallableAgent): Promise<Installed> {
  if (!isTauri()) throw new Error('Installing an agent needs the desktop app.')
  return InstalledSchema.parse(await invoke<unknown>('install_agent', { agent }))
}

const PERCENT_MAX = 100
const InstallProgressSchema = z.object({
  agent: z.string(),
  /** Read from the installer's own output; null when the line carried none. */
  percent: z.number().int().min(0).max(PERCENT_MAX).nullable(),
  /** One cleaned line of the installer's output. */
  line: z.string(),
})
export type InstallProgress = z.infer<typeof InstallProgressSchema>

/** Calls back with each line an install prints, with its percent when it had one. */
export function listenInstallProgress(onProgress: (progress: InstallProgress) => void): Promise<() => void> {
  return listen<unknown>('install-progress', (event) => {
    const parsed = InstallProgressSchema.safeParse(event.payload)
    if (!parsed.success) {
      console.warn('The host sent an install progress this window cannot read', parsed.error.issues)
      return
    }
    onProgress(parsed.data)
  })
}
