import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

const AcpAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  source: z.enum(['registry', 'config']),
  installed: z.string().nullable(),
  unavailable: z.string().nullable(),
})

/**
 * An agent that can run as a chat over ACP on this computer (ADR 0021): one the config names, or one the ACP registry
 * lists. `installed` is the version here (empty for a config entry, which is always ready), null when it is not
 * installed; `unavailable` is why it cannot be installed here, when it cannot.
 */
export type AcpAgent = z.infer<typeof AcpAgentSchema>

const NEEDS_APP = 'Agents from the ACP registry need the desktop app.'

/** The agents that can run over ACP here: the config's first, then the registry's in its own order. */
export async function loadAcpAgents(): Promise<AcpAgent[]> {
  if (!isTauri()) throw new Error(NEEDS_APP)
  return z.array(AcpAgentSchema).parse(await invoke<unknown>('acp_agents'))
}

/** Installs the registry's agent `id`, or replaces it with its newest version. Rejects with the real reason. */
export async function installAcpAgent(id: string): Promise<void> {
  if (!isTauri()) throw new Error(NEEDS_APP)
  await invoke<unknown>('install_acp_agent', { id })
}

/** Removes an agent installed from the registry, and its files. */
export async function removeAcpAgent(id: string): Promise<void> {
  if (!isTauri()) throw new Error(NEEDS_APP)
  await invoke<unknown>('remove_acp_agent', { id })
}
