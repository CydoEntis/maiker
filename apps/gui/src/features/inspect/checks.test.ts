import { describe, expect, it } from 'vitest'
import { CheckSchema } from './checks'

describe('a pane’s checks', () => {
  it('reads what the daemon sends, with the daemon’s defaults for what it leaves out', () => {
    const parsed = CheckSchema.parse({ state: 'Failed', source: { Repo: { file: '.maiker/checks.toml' } } })
    expect(parsed).toMatchObject({ state: 'Failed', name: '', exit_code: null })
    expect(parsed.source).toEqual({ Repo: { file: '.maiker/checks.toml', uncommitted: false } })
    expect(CheckSchema.parse({}).state).toBe('CouldNotRun')
  })
})
