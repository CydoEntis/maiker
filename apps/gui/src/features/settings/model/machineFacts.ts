import type { MachineFacts as WireFacts } from '@/api/machineFacts'
import type { MachineFacts } from './addStage'

const OS_NAMES: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' }

/** What the machine's daemon said about itself, as the lines the Machine added step shows: "Ubuntu 24.04 · 8 cores", "claude 2.1, codex". */
export function factsForDisplay(wire: WireFacts): MachineFacts {
  const system = wire.os_version ?? OS_NAMES[wire.os] ?? wire.os
  const cores = `${String(wire.cpu_cores)} ${wire.cpu_cores === 1 ? 'core' : 'cores'}`
  return {
    system: `${system} · ${cores}`,
    agents: wire.agents.map((agent) => (agent.version === null ? agent.name : `${agent.name} ${agent.version}`)),
    ...(wire.host_name === null ? {} : { reportedName: wire.host_name }),
  }
}
