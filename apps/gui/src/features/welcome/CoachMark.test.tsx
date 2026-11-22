import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { CoachMark } from './CoachMark'
import { dismissCoachMark, offerCoachMark } from './coachMark'

const tip = () => screen.queryByRole('status', { name: 'Side panel tip' })

beforeEach(() => { localStorage.clear(); dismissCoachMark() })

describe('the side-panel tip', () => {
  it('shows once: a second offer on the same computer shows nothing', async () => {
    const user = userEvent.setup()
    render(<CoachMark panelShown={false} covered={false} />)
    expect(tip()).toBeNull()
    act(() => { offerCoachMark() })
    expect(tip()).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Got it' }))
    expect(tip()).toBeNull()
    act(() => { offerCoachMark() })
    expect(tip()).toBeNull()
  })

  it('closes on Esc, but leaves Esc to a dialog that is open over the window', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CoachMark panelShown={false} covered />)
    act(() => { offerCoachMark() })
    await user.keyboard('{Escape}')
    expect(tip()).not.toBeNull()
    rerender(<CoachMark panelShown={false} covered={false} />)
    await user.keyboard('{Escape}')
    expect(tip()).toBeNull()
  })

  it('closes when the side panel is shown', () => {
    const { rerender } = render(<CoachMark panelShown={false} covered={false} />)
    act(() => { offerCoachMark() })
    rerender(<CoachMark panelShown covered={false} />)
    expect(tip()).toBeNull()
  })

  it('takes no focus when it shows', () => {
    render(<><button type="button">Elsewhere</button><CoachMark panelShown={false} covered={false} /></>)
    screen.getByRole('button', { name: 'Elsewhere' }).focus()
    act(() => { offerCoachMark() })
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus()
  })
})
