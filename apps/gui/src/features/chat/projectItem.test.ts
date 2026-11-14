import { describe, expect, it } from 'vitest'
import { fields } from './eventFixtures'
import { projectItem } from './projectItem'

const tool = (label: string, output: string, input?: unknown) => ({ Tool: { kind: 'commandExecution', label, output, ...(input === undefined ? {} : { input }) } })

describe('a slash command run in a Claude terminal', () => {
  it('shows what it printed as a note, while a Bash command stays a command step', () => {
    const base = fields('o1')

    expect(projectItem('claude', tool('/model', 'Set model to Haiku 5.5'), base)).toEqual([{ ...base, kind: 'note', text: 'Set model to Haiku 5.5' }])
    expect(projectItem('claude', tool('/usr/bin/env', 'x', { command: '/usr/bin/env' }), base)[0]).toMatchObject({ kind: 'command' })
    expect(projectItem('claude', tool('/opt run', 'x', { command: '/opt run' }), base)[0]).toMatchObject({ kind: 'command' })
  })
})
