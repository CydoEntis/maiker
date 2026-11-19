import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBadge } from './glyphs'

describe('the working badge', () => {
  it('is the one spinner: a ring with a running light, whatever spinner style was saved', () => {
    const { container } = render(<StatusBadge status="working" />)
    expect(container.querySelector('.mx-badge.is-working .mx-status-icon.is-working .mx-status-light')).not.toBeNull()
  })
})
