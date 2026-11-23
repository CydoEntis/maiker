import { describe, expect, it } from 'vitest'
import { foldersHolding } from './fileTag'

describe('a file in the tree', () => {

  it('marks every folder above a changed file', () => {
    expect([...foldersHolding(['src/a/x.ts', 'src/y.ts', 'z.ts'])].sort()).toEqual(['src', 'src/a'])
  })
})
