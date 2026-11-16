import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlainToast } from './PlainToast'

describe('plain toast', () => {
  it('draws no mark for a plain message, where an empty box would say nothing', () => {
    const { container } = render(<PlainToast id={1} kind="message" title="Closed dev" options={{}} />)

    expect(container.querySelector('.mx-notice-icon')).toBeNull()
  })

  it('keeps the mark that says how a success, error or warning went', () => {
    for (const kind of ['success', 'error', 'warning'] as const) {
      const { container, unmount } = render(<PlainToast id={1} kind={kind} title="Done" options={{}} />)

      expect(container.querySelector('.mx-notice-icon .mx-notice-mark')).not.toBeNull()
      unmount()
    }
  })
})
