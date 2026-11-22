import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './button'
import { Fold } from './fold'
import { FileBadge } from './tag'

describe('Button', () => {

  it('takes keyboard focus and presses with Enter and Space, but not while disabled', async () => {
    const user = userEvent.setup()
    const press = vi.fn()
    render(<><Button onClick={press}>Go</Button><Button disabled onClick={press}>Stopped</Button></>)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Go' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(press).toHaveBeenCalledTimes(2)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Stopped' })).not.toHaveFocus()
  })
})

describe('Tag and FileBadge', () => {

  it('shows the folder dimmed, keeps the whole path as its title, and opens from the keyboard', async () => {
    const user = userEvent.setup()
    const open = vi.fn()
    render(<FileBadge path="src/auth/session.ts" line={12} onOpen={open} />)
    const badge = screen.getByRole('button', { name: /session\.ts/ })
    expect(badge).toHaveAttribute('title', 'src/auth/session.ts')
    expect(screen.getByText('src/auth/')).toBeInTheDocument()
    expect(screen.getByText(':12')).toBeInTheDocument()
    expect(badge.querySelector('[data-slot="type-tag"]')).toBeNull()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(open).toHaveBeenCalledOnce()
  })
})

describe('Fold, Progress and Toast', () => {
  it('says what it would show while closed and Hide while open, and toggles by keyboard', async () => {
    const user = userEvent.setup()
    const toggle = vi.fn()
    const { rerender } = render(<Fold open={false} onToggle={toggle} more="Show 12 more lines" />)
    const fold = screen.getByRole('button', { name: 'Show 12 more lines' })
    expect(fold).toHaveAttribute('aria-expanded', 'false')
    await user.tab()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveBeenCalledOnce()
    rerender(<Fold open onToggle={toggle} more="Show 12 more lines" />)
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true')
  })

})
