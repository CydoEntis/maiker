import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PaneViewSwitch } from './PaneViewSwitch'

describe('PaneViewSwitch', () => {
  it('offers Chat and Terminal in that order and says which is picked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<PaneViewSwitch views={['terminal', 'chat']} view="terminal" onChange={onChange} />)
    expect(screen.getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Chat', 'Terminal'])
    expect(screen.getByRole('radio', { name: /^Terminal view/ })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: /^Chat view/ }))
    expect(onChange).toHaveBeenCalledWith('chat')
  })
})
