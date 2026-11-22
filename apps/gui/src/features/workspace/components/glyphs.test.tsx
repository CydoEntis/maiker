import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { iconSaysProcess } from '../model/session'
import { AppIcon } from './glyphs'

describe('app icons', () => {

  it('keeps the name of a program that has no icon, since a tinted letter does not say what it is', () => {
    const { container } = render(<AppIcon process="vim" size={24} />)
    expect(container.querySelector('.is-tinted')).not.toBeNull()
    expect(iconSaysProcess('vim')).toBe(false)
  })
})
