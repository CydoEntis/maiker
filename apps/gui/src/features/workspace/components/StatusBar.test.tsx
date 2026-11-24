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
  const props = { version: '0.80.0', update: <button type="button">Update to 0.81.0</button>, usages, currentAgent: 'claude', commandsKeys: 'Ctrl+Shift+P', shortcutsKeys: 'Ctrl+/', onOpenCommands: vi.fn(), onOpenShortcuts: vi.fn(), onOpenUsage: vi.fn(), ...extra }
  render(<StatusBar {...props} />)
  return props
}

describe('StatusBar', () => {

  it('shows every limit of every agent, the 5-hour and the weekly one both', () => {
    bar()
    const meters = screen.getByRole('group', { name: 'Usage limits' }).querySelectorAll('[role="meter"]')
    expect(Array.from(meters).map((meter) => [meter.getAttribute('aria-label'), meter.getAttribute('aria-valuenow')])).toHaveLength(3)
    expect(screen.getByRole('group', { name: 'Usage limits' })).toHaveTextContent(/5h.*30%.*Week.*75%.*Week.*95%/)
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

  it('says the keys it was given, never its own, and each hint opens its sheet', async () => {
    const props = bar({ commandsKeys: 'F1', shortcutsKeys: 'F2' })
    const commands = screen.getByRole('button', { name: /Commands/ })
    const shortcuts = screen.getByRole('button', { name: /Shortcuts/ })
    expect(commands).toHaveTextContent('F1')
    expect(shortcuts).toHaveTextContent('F2')
    await userEvent.click(commands)
    expect(props.onOpenCommands).toHaveBeenCalledOnce()
    expect(props.onOpenShortcuts).not.toHaveBeenCalled()
    await userEvent.click(shortcuts)
    expect(props.onOpenShortcuts).toHaveBeenCalledOnce()
  })

  it('keeps a hint that has no key on this platform, so its sheet can still be opened', async () => {
    const props = bar({ shortcutsKeys: '' })
    await userEvent.click(screen.getByRole('button', { name: 'Shortcuts' }))
    expect(props.onOpenShortcuts).toHaveBeenCalledOnce()
  })
})
