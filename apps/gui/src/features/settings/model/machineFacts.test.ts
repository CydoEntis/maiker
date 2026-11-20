import { describe, expect, it } from 'vitest'
import { factsForDisplay } from './machineFacts'

describe('what a machine says it is, as the Machine added step shows it', () => {
  it('joins the system and the cores, lists the agents with their versions, and keeps the machine’s own name', () => {
    expect(factsForDisplay({ host_name: 'gpu-box', os: 'linux', os_version: 'Ubuntu 24.04', arch: 'x86_64', cpu_cores: 8, agents: [{ name: 'claude', version: '2.1.3' }, { name: 'codex', version: null }] }))
      .toEqual({ system: 'Ubuntu 24.04 · 8 cores', agents: ['claude 2.1.3', 'codex'], reportedName: 'gpu-box' })
  })

  it('falls back to the system family when it gives no version, says 1 core in the singular and leaves the name out when it has none', () => {
    expect(factsForDisplay({ host_name: null, os: 'macos', os_version: null, arch: 'aarch64', cpu_cores: 1, agents: [] }))
      .toEqual({ system: 'macOS · 1 core', agents: [] })
  })
})
