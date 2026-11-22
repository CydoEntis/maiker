import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Popover } from 'radix-ui'
import { describe, expect, it, vi } from 'vitest'
import { StopSlider } from './stop-slider'

const STOPS = [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'max', label: 'Max' }]

function Harness({ stops = STOPS, start = 'low' as string | null, disabled = false, onChange = vi.fn() }) {
  const [value, setValue] = useState(start)
  return <StopSlider aria-label="Effort" stops={stops} value={value} disabled={disabled} onValueChange={(next) => { onChange(next); setValue(next) }} />
}

describe('the stop slider', () => {

  it('picks a stop when its word or its dot is clicked', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('High'))
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', 'High')
    await user.click(screen.getByText('Max').closest('button') as HTMLElement)
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '3')
  })

  it('moves one stop with Left and Right and stops at the ends', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness start="medium" onChange={onChange} />)
    await user.tab()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', 'Max')
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledTimes(2)
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}')
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', 'Low')
  })

  it('says so, and starts from an end, while nothing is picked', async () => {
    const user = userEvent.setup()
    render(<Harness start={null} />)
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuetext', 'Not picked')
    expect(slider).not.toHaveAttribute('aria-valuenow')
    await user.tab()
    await user.keyboard('{ArrowRight}')
    expect(slider).toHaveAttribute('aria-valuetext', 'Low')
  })

  it('reports a press on the stop already picked, so a caller can let go of it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByText('Low'))
    expect(onChange).toHaveBeenCalledWith('low')
  })

  it('does nothing while disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness disabled onChange={onChange} />)
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByText('High'))
    slider.focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('leaves a popover it sits in open, and keeps the arrow keys from reaching it', async () => {
    const user = userEvent.setup()
    const outerKey = vi.fn()
    render(
      <Popover.Root defaultOpen>
        <Popover.Trigger>open</Popover.Trigger>
        <Popover.Content onKeyDown={outerKey}><Harness /></Popover.Content>
      </Popover.Root>,
    )
    await user.click(screen.getByText('High'))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', 'Max')
    expect(outerKey).not.toHaveBeenCalled()
  })
})
