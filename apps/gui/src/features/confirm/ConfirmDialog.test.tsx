import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { confirmAsk, withSkipped, type SkippedConfirms } from './confirm'
import { ConfirmHost } from './ConfirmDialog'
import { useConfirm } from './useConfirm'

/** A window with one thing to remove: its button asks through the confirm, and the skipped kinds are kept as settings keep them. */
function Remover({ run }: { run: () => void }) {
  const [skipped, setSkipped] = useState<SkippedConfirms>([])
  const { confirm, pending } = useConfirm(skipped, (kind) => { setSkipped((current) => withSkipped(current, kind)) })
  return (
    <>
      <button type="button" onClick={() => { confirm(confirmAsk('close-project', { name: 'shop', running: [] }), run) }}>Close shop</button>
      <ConfirmHost pending={pending} />
    </>
  )
}

const ask = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Close shop' }))
  return screen.findByRole('alertdialog')
}

describe('the confirm dialog', () => {
  it('is drawn inside the window root, where its theme, corners and float are set', async () => {
    const user = userEvent.setup()
    render(<Remover run={vi.fn()} />, { container: document.body.appendChild(Object.assign(document.createElement('div'), { className: 'mx-app' })) })
    expect((await ask(user)).closest('.mx-app')).not.toBeNull()
  })

  it('runs the action once on the primary button, which has focus, and closes', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    render(<Remover run={run} />)
    await ask(user)
    expect(run).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Close project' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(run).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('does not run the action on Cancel or Escape, gives focus back, and asks again next time', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    render(<Remover run={run} />)
    await ask(user)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await ask(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close shop' })).toHaveFocus()
    expect(run).not.toHaveBeenCalled()
  })

  it('skips the next ask once the box was ticked and the action confirmed', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    render(<Remover run={run} />)
    await ask(user)
    await user.click(screen.getByRole('checkbox', { name: 'Don’t ask again' }))
    await user.click(screen.getByRole('button', { name: 'Close project' }))
    expect(run).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Close shop' }))
    expect(run).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('keeps asking when the box was ticked but the question cancelled', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    render(<Remover run={run} />)
    await ask(user)
    await user.click(screen.getByRole('checkbox', { name: 'Don’t ask again' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await ask(user)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Don’t ask again' })).not.toBeChecked()
    expect(run).not.toHaveBeenCalled()
  })

  it('confirms with Enter from the checkbox, taking the tick with it', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    render(<Remover run={run} />)
    await ask(user)
    const box = screen.getByRole('checkbox', { name: 'Don’t ask again' })
    await user.click(box)
    await user.keyboard('{Enter}')
    expect(run).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Close shop' }))
    expect(run).toHaveBeenCalledTimes(2)
  })
})
