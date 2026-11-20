/**
 * Colour for what a command printed (design: failed lines red, the summary line coloured). The words of the output are
 * never changed, only cut into runs that carry a tone, so copying it gives back exactly what the command wrote.
 */
export type OutputTone = 'plain' | 'pass' | 'fail' | 'error' | 'label'
export type OutputSegment = { readonly text: string; readonly tone: OutputTone }

const PASS_MARK = /^(\s*)(✓|PASS\b|\[✓\])/
const FAIL_MARK = /^(\s*)(✗|×|FAIL\b)/
const SUMMARY = /^(\s*)(Test Files|Tests)(\s.*)$/
const COUNT = /(\d+ failed|\d+ passed)/
const ERROR_LINE = /\bError\b|\berror:|\bpanicked\b|^\s*expected\b/

function segmentsOfLine(line: string): OutputSegment[] {
  const fail = FAIL_MARK.exec(line)
  if (fail !== null) return [{ text: fail[0], tone: 'fail' }, { text: line.slice(fail[0].length), tone: 'plain' }]
  const pass = PASS_MARK.exec(line)
  if (pass !== null) return [{ text: pass[0], tone: 'pass' }, { text: line.slice(pass[0].length), tone: 'plain' }]
  const summary = SUMMARY.exec(line)
  if (summary !== null) {
    const counts = (summary[3] ?? '').split(COUNT).filter((part) => part !== '').map((part): OutputSegment => ({ text: part, tone: part.endsWith('failed') && COUNT.test(part) ? 'fail' : part.endsWith('passed') && COUNT.test(part) ? 'pass' : 'plain' }))
    return [{ text: `${summary[1] ?? ''}${summary[2] ?? ''}`, tone: 'label' }, ...counts]
  }
  return [{ text: line, tone: ERROR_LINE.test(line) ? 'error' : 'plain' }]
}

/** The output as runs of one tone each, in order; joined, their text is the output. */
export function outputSegments(output: string): OutputSegment[] {
  const runs: OutputSegment[] = []
  const lines = output.split('\n')
  lines.forEach((line, index) => {
    const parts = segmentsOfLine(line)
    const last = parts.at(-1)
    if (index < lines.length - 1 && last !== undefined) parts[parts.length - 1] = { text: `${last.text}\n`, tone: last.tone }
    for (const part of parts) {
      if (part.text === '') continue
      const previous = runs.at(-1)
      if (previous !== undefined && previous.tone === part.tone) runs[runs.length - 1] = { text: previous.text + part.text, tone: part.tone }
      else runs.push(part)
    }
  })
  return runs
}
