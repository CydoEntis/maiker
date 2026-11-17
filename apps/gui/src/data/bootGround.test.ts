import { afterEach, describe, expect, it } from 'vitest'
import { GROUND_KEY, rememberGround } from './bootGround'

afterEach(() => {
  localStorage.clear()
  document.documentElement.style.backgroundColor = ''
})

describe('rememberGround', () => {
  it('paints the page and keeps a hex ground for the next start', () => {
    rememberGround('#05131a')
    expect(localStorage.getItem(GROUND_KEY)).toBe('#05131a')
    expect(document.documentElement.style.backgroundColor).toBe('rgb(5, 19, 26)')
  })

  it('keeps nothing that is not a hex colour, so the boot script never paints an injected value', () => {
    rememberGround('red; background-image: url(x)')
    expect(localStorage.getItem(GROUND_KEY)).toBeNull()
  })
})
