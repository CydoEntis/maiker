import type { DiffHunk } from '../chatEvents'

export type DiffRow = {
  key: string
  sign: string
  text: string
  tone: 'add' | 'remove' | 'context' | 'header'
  /** The line's number in the file (the old file for a removed line); null where the hunk header does not say. */
  number: number | null
  /** The line's number in the old file, null for an added line. */
  oldNumber: number | null
  /** The line's number in the new file, null for a removed line. */
  newNumber: number | null
}

const HUNK_START = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Where a hunk starts in the old and new file, read from its `@@ -a,b +c,d @@` header. */
function hunkStart(header: string): { old: number; new: number } | null {
  const match = HUNK_START.exec(header)
  return match === null ? null : { old: Number(match[1]), new: Number(match[2]) }
}

/** The lines a diff card draws: each hunk's header, then its lines with a sign and, where known, a line number. */
export function diffRows(hunks: readonly DiffHunk[]): DiffRow[] {
  return hunks.flatMap((hunk, hunkIndex) => {
    const start = hunkStart(hunk.header)
    let oldLine = start?.old ?? null
    let newLine = start?.new ?? null
    const lines = hunk.lines.map((line, lineIndex): DiffRow => {
      const oldNumber = line.kind === 'add' ? null : oldLine
      const newNumber = line.kind === 'remove' ? null : newLine
      if (oldNumber !== null && oldLine !== null) oldLine += 1
      if (newNumber !== null && newLine !== null) newLine += 1
      const number = line.kind === 'remove' ? oldNumber : newNumber
      return { key: `${String(hunkIndex)}:${String(lineIndex)}`, sign: line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' ', text: line.text, tone: line.kind, number, oldNumber, newNumber }
    })
    const header = hunk.header === '' ? [] : [{ key: `${String(hunkIndex)}h`, sign: '', text: hunk.header, tone: 'header' as const, number: null, oldNumber: null, newNumber: null }]
    return [...header, ...lines]
  })
}
