import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NewWorktreeDialog } from './NewWorktreeDialog'

vi.mock('@/features/inspect/api', () => ({
  repoBranches: vi.fn(() => Promise.resolve([{ name: 'main' }])),
  repoWorktrees: vi.fn(() => Promise.resolve([])),
}))

function open(onCreate = vi.fn(() => Promise.resolve())) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <NewWorktreeDialog term={2} repoName="maitty" machine={0} onCreate={onCreate} onCancel={vi.fn()} />
    </QueryClientProvider>,
  )
  return { onCreate, field: screen.getByRole('textbox', { name: 'Branch name' }) }
}

describe('the new worktree dialog', () => {
  it('says nothing while you type a name git refuses, and says why under the field once you leave it', async () => {
    const user = userEvent.setup()
    const { field } = open()
    await user.type(field, 'feat new login')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(field).not.toHaveAttribute('aria-invalid')

    await user.tab()
    const error = screen.getByRole('alert')
    expect(error).toHaveTextContent('Branch names can’t contain spaces. Try feat-new-login.')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAttribute('aria-describedby', error.id)
    // The field keeps what you typed.
    expect(field).toHaveValue('feat new login')
  })

  it('on Create, shows the problem, puts you back in the field and starts nothing', async () => {
    const user = userEvent.setup()
    const { field, onCreate } = open()
    await user.type(field, 'a..b')
    await user.click(screen.getByRole('button', { name: 'Create worktree' }))
    expect(screen.getByRole('alert')).toHaveTextContent('A branch name cannot hold .. or // or @{')
    expect(field).toHaveFocus()
    expect(onCreate).not.toHaveBeenCalled()

    await user.clear(field)
    await user.type(field, 'feat/login')
    await user.click(screen.getByRole('button', { name: 'Create worktree' }))
    expect(onCreate).toHaveBeenCalledWith('feat/login', null)
  })
})
