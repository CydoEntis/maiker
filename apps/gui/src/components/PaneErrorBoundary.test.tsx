import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PaneErrorBoundary } from './PaneErrorBoundary'

let broken = true
function Chat() {
  if (broken) throw new Error('bad row')
  return <p>the chat</p>
}

describe('a pane that fails to draw', () => {
  it('says so in the pane only, offers the terminal, and draws again on Try again', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const showTerminal = vi.fn()
    render(<><PaneErrorBoundary what="This chat" fallback={{ label: 'Show the terminal', run: showTerminal }}><Chat /></PaneErrorBoundary><p>another pane</p></>)

    expect(screen.getByRole('alert')).toHaveTextContent('This chat hit a problem')
    expect(screen.getByText('another pane')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show the terminal' }))
    expect(showTerminal).toHaveBeenCalled()

    broken = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('the chat')).toBeInTheDocument()
    quiet.mockRestore()
  })
})
