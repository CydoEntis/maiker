import { describe, expect, it } from 'vitest'
import { fullPathOf } from './format'

describe('a project file’s full path', () => {
  it('joins the checkout and the project path with the checkout’s own separators', () => {
    expect(fullPathOf('/home/me/app', 'src/cart/total.ts')).toBe('/home/me/app/src/cart/total.ts')
    expect(fullPathOf('C:\\code\\app', 'src/cart/total.ts')).toBe('C:\\code\\app\\src\\cart\\total.ts')
    expect(fullPathOf('/home/me/app/', 'README.md')).toBe('/home/me/app/README.md')
  })
})
