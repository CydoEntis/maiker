import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { agentUsages } from '@/features/usage/agentLimits'
import { StatusBar } from './StatusBar'

const NOW = 1_000_000
const limit = (name: string, used: number) => ({ name, used, resetsAt: NOW + 86_400 })
const usages = agentUsages([
  { process: 'claude', limits: [limit('5h', 30), limit('week', 75)] },
  { process: 'codex', limits: [limit('week', 95)] },
], { claude: 'pro' }, NOW)

function bar(extra: Partial<Parameters<typeof StatusBar>[0]> = {}) {
  const props = { version: '0.80.0', update: <button type="button">Update to 0.81.0</button>, usages, currentAgent: 'claude', commandsKeys: 'Ctrl+Shift+K', onOpenCommands: vi.fn(), onOpenUsage: vi.fn(), ...extra }
  render(<StatusBar {...props} />)
  return props
}

describe('StatusBar', () => {
  it('names the version and carries the update at the left', () => {
    bar()
    expect(screen.getByText('Maiker 0.80.0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update to 0.81.0' })).toBeInTheDocument()
  })

  it('shows one meter per agent, each at its tightest limit', () => {
    bar()
    const meters = screen.getByRole('group', { name: 'Usage limits' })
    expect(meters.querySelectorAll('button')).toHaveLength(2)
    expect(meters).toHaveTextContent('75%')
    expect(meters).toHaveTextContent('95%')
    expect(meters).not.toHaveTextContent('30%')
  })

  it('colours a meter amber from 70 and red from 90', () => {
    bar()
    const [claude, codex] = Array.from(screen.getByRole('group', { name: 'Usage limits' }).querySelectorAll('button'))
    expect(claude).toHaveClass('is-warn')
    expect(codex).toHaveClass('is-hot')
  })

  it('lights the meter of the agent in focus', () => {
    bar({ currentAgent: 'codex' })
    const [claude, codex] = Array.from(screen.getByRole('group', { name: 'Usage limits' }).querySelectorAll('button'))
    expect(claude).not.toHaveClass('is-current')
    expect(codex).toHaveClass('is-current')
  })

  it('draws no meters when no agent has reported a limit', () => {
    bar({ usages: [] })
    expect(screen.queryByRole('group', { name: 'Usage limits' })).toBeNull()
  })

  it('opens the usage popover from a meter, with every limit of every agent', async () => {
    const props = bar()
    await userEvent.click(screen.getByRole('group', { name: 'Usage limits' }).querySelector('button') as HTMLElement)
    const popover = await screen.findByRole('dialog', { name: 'Usage limits' })
    expect(popover).toHaveTextContent('Claude')
    expect(popover).toHaveTextContent('5-hour limit')
    expect(popover).toHaveTextContent('Codex')
    await userEvent.click(screen.getByRole('button', { name: 'Usage & cost' }))
    expect(props.onOpenUsage).toHaveBeenCalled()
  })

  it('says the commands key and opens the palette', async () => {
    const props = bar()
    await userEvent.click(screen.getByRole('button', { name: /Commands/ }))
    expect(screen.getByText('Ctrl+Shift+K')).toBeInTheDocument()
    expect(props.onOpenCommands).toHaveBeenCalled()
  })
})
