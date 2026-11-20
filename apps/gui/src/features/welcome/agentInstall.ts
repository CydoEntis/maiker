import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { z } from 'zod'

/*
 * The setup's agent installs. The desktop shell owns the installer for each agent (fixed commands, never text from
 * here); this file only names the three calls: the command to show first, running it, and its progress.
 */

const InstallResultSchema = z.object({ version: z.string().nullable() })
const ProgressSchema = z.object({ agent: z.string(), percent: z.number().nullable(), line: z.string() })

export type InstallResult = z.infer<typeof InstallResultSchema>
/** One report from a running install: how far (null when it cannot tell) and the installer's latest line. */
export type InstallProgress = z.infer<typeof ProgressSchema>

export const INSTALL_PROGRESS_EVENT = 'install-progress'

/** The exact command that installing `agent` runs, to show before it runs. */
export async function agentInstallCommand(agent: string): Promise<string> {
  return z.string().parse(await invoke('agent_install_command', { agent }))
}

/** Installs `agent`. Resolves with the version now on this computer (null when it cannot be read); rejects with why it failed. */
export async function installAgent(agent: string): Promise<InstallResult> {
  return InstallResultSchema.parse(await invoke('install_agent', { agent }))
}

/** Calls `onProgress` for every install in flight. Resolves with the function that stops listening. */
export function listenInstallProgress(onProgress: (progress: InstallProgress) => void): Promise<() => void> {
  return listen<unknown>(INSTALL_PROGRESS_EVENT, (event) => {
    const parsed = ProgressSchema.safeParse(event.payload)
    if (parsed.success) onProgress(parsed.data)
  })
}
