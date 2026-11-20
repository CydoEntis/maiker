import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ViewSwitch } from './ViewSwitch'

describe('ViewSwitch', () => {
  it('shows the current view as picked, with a plain word for each', () => {
    render(<ViewSwitch view="chat" onChange={vi.fn()} />)
    expect(screen.getByRole('radio', { name: 'Chat' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Terminal' })).not.toBeChecked()
  })

  it('switches the view when the other choice is clicked', async () => {
    const onChange = vi.fn()
    render(<ViewSwitch view="chat" onChange={onChange} />)
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Terminal' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('terminal')
  })
})
