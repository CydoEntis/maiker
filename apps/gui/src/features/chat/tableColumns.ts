import { inlineText, type TableBlock } from './exportBlock'

/** A figure, maybe signed, with a currency in front or a short unit after: `1,204`, `-3.5`, `$4.20`, `0.8 ms`, `12%`. */
const FIGURE = /^[-+−]?[$€£]?\d[\d,]*(\.\d+)?\s?(%|[A-Za-zµ]{1,3})?$/

/**
 * Which of a table's columns hold figures: every cell under its header that has text is one. Such a column is set
 * right and in mono so its digits line up; an empty column is not one.
 */
export function numericColumns(table: TableBlock): readonly boolean[] {
  return table.header.map((_, column) => {
    const cells = table.rows.map((row) => inlineText(row[column] ?? []).trim()).filter((text) => text !== '')
    return cells.length > 0 && cells.every((text) => FIGURE.test(text))
  })
}
