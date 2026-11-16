import { describe, expect, it } from 'vitest'
import type { TableBlock } from './exportBlock'
import type { Inline } from './markdown'
import { numericColumns } from './tableColumns'

const text = (value: string): Inline[] => [{ kind: 'text', text: value }]

const table = (header: string[], rows: string[][]): TableBlock => ({ align: header.map(() => null), header: header.map(text), rows: rows.map((row) => row.map(text)) })

describe('numericColumns', () => {
  it('finds the columns of figures, with units, currencies and empty cells', () => {
    const shown = table(['Store', 'Lookup', 'Cost', 'Note'], [['Postgres', '0.8 ms', '$4.20', ''], ['Redis', '0.2 ms', '1,204', 'fast']])
    expect(numericColumns(shown)).toEqual([false, true, true, false])
  })

  it('calls no column numeric when it has nothing in it, or a word among the figures', () => {
    expect(numericColumns(table(['A', 'B'], [['', '12'], ['', 'n/a']]))).toEqual([false, false])
  })
})
