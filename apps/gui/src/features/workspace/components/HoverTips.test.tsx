import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HoverTips } from './HoverTips'

const wait = (ms: number) => { act(() => { vi.advanceTimersByTime(ms) }) }

describe('hover tips', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('shows a title as a tooltip after a short hover and hides it on leaving', () => {
    render(<><HoverTips /><button type="button" title="Close session">x</button></>)
    const button = screen.getByRole('button')

    fireEvent.pointerOver(button)
    expect(button).not.toHaveAttribute('title')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    wait(430)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Close session')

    fireEvent.pointerOut(button)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(button).toHaveAttribute('title', 'Close session')
  })

  describe('timing', () => {

    it.each([
      ['a mouse press', () => { fireEvent.pointerDown(document.body) }],
      ['a key press', () => { fireEvent.keyDown(document.body, { key: 'a' }) }],
      ['the wheel', () => { fireEvent.wheel(document.body) }],
    ])('hides a tip on %s', (_name, act_) => {
      render(<><HoverTips /><button type="button" title="One">a</button></>)
      fireEvent.pointerOver(screen.getByRole('button'))
      wait(430)
      expect(screen.getByRole('tooltip')).toBeInTheDocument()
      act_()
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
  })

  describe('where the words come from', () => {
    it('reads the aria-label of an icon-only button', () => {
      render(<><HoverTips /><button type="button" aria-label="Collapse sidebar"><svg /></button></>)
      fireEvent.pointerOver(screen.getByRole('button'))
      wait(430)
      expect(screen.getByRole('tooltip')).toHaveTextContent('Collapse sidebar')
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Collapse sidebar')
    })
  })

  describe('while something richer is open', () => {
    it('shows no tip while a menu is open', () => {
      render(<><HoverTips /><div role="menu" aria-label="Menu" /><button type="button" title="One">x</button></>)
      fireEvent.pointerOver(screen.getByRole('button'))
      wait(500)
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
  })
})
