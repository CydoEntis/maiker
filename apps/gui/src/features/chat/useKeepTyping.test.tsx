import { render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { useKeepTyping } from './useKeepTyping'

function Box({ count }: { count: number }) {
  const text = useRef<HTMLTextAreaElement>(null)
  useKeepTyping(text, count)
  return (
    <>
      <textarea ref={text} aria-label="Message" defaultValue="half a sentence" />
      <input aria-label="Other field" />
      <button type="button">Elsewhere</button>
    </>
  )
}

describe('keeping the message box ready to type as attachments land', () => {
  it('gives focus back to the box, caret at the end, when an attachment lands and focus was on the page', () => {
    const { rerender } = render(<Box count={0} />)
    screen.getByRole('button', { name: 'Elsewhere' }).focus()
    rerender(<Box count={1} />)
    const box = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' })
    expect(box).toHaveFocus()
    expect(box.selectionStart).toBe('half a sentence'.length)
  })

  it('never takes focus from another field a person is typing in', () => {
    const { rerender } = render(<Box count={0} />)
    screen.getByRole('textbox', { name: 'Other field' }).focus()
    rerender(<Box count={1} />)
    expect(screen.getByRole('textbox', { name: 'Other field' })).toHaveFocus()
  })

  it('leaves focus alone when an attachment is removed', () => {
    const { rerender } = render(<Box count={2} />)
    screen.getByRole('button', { name: 'Elsewhere' }).focus()
    rerender(<Box count={1} />)
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus()
  })
})
