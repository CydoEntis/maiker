import { describe, expect, it } from 'vitest'
import { approvalRows, HELPERS_ROWS, movedHighlight, ownChoiceIndex, promptRows, rowForKey } from './answerRows'

const shape = (rows: readonly { id: string; key: string | null; quiet?: boolean }[]) => rows.map((row) => [row.id, row.key, row.quiet === true])

describe('the rows a pending request offers', () => {
  it('offers Claude its two answers and the remembered one, and no "this session" it does not have', () => {
    const rows = approvalRows({ choices: ['Accept', 'Decline'], canRemember: true }, true)
    expect(shape(rows)).toEqual([['Accept', 'y', false], ['Decline', 'n', false], ['remember', null, true]])
  })

  it('offers Codex once, this session and no on y, a and n, and leaves Cancel to Esc', () => {
    const rows = approvalRows({ choices: ['Accept', 'AcceptForSession', 'Decline', 'Cancel'], canRemember: false }, true)
    expect(shape(rows)).toEqual([['Accept', 'y', false], ['AcceptForSession', 'a', false], ['Decline', 'n', false]])
  })

  it("words an ACP agent's options as the agent named them, each on the key of what it decides", () => {
    const rows = approvalRows({ choices: ['Accept', 'Cancel', 'Decline'], choiceLabels: ['Allow edit', 'Stop', 'Reject edit'], canRemember: false }, true)
    expect(rows.map((row) => [row.label, row.key])).toEqual([['Allow edit', 'y'], ['Reject edit', 'n']])
  })

  it.each([
    ['the daemon cannot remember the request', { choices: ['Accept', 'Decline'] as const, canRemember: false }, true],
    ['the chat cannot send it', { choices: ['Accept', 'Decline'] as const, canRemember: true }, false],
    ['the request has no yes to remember', { choices: ['Decline'] as const, canRemember: true }, true],
  ])('has no remembered row when %s', (_name, event, canSend) => {
    expect(approvalRows(event, canSend).map((row) => row.id)).not.toContain('remember')
  })

  it('offers nothing for a request with no choices', () => {
    expect(approvalRows({ choices: [], canRemember: true }, true)).toEqual([])
  })
})

describe("the rows of a prompt in an agent's terminal", () => {
  it("has yes once and no, then the agent's own choices in its words, on no key", () => {
    const rows = promptRows([{ index: 1, label: "Yes, and don't ask again" }])
    expect(rows.map((row) => [row.label, row.key])).toEqual([['Yes once', 'y'], ['No', 'n'], ["Yes, and don't ask again", null]])
    expect(rows.map((row) => ownChoiceIndex(row.id))).toEqual([null, null, 1])
  })
})

describe('which key picks which row', () => {
  const rows = approvalRows({ choices: ['Accept', 'AcceptForSession', 'Decline'], canRemember: true }, true)

  it.each([['y', 'Accept'], ['a', 'AcceptForSession'], ['n', 'Decline'], ['Y', 'Accept']])('%s picks %s', (key, id) => {
    expect(rowForKey(rows, key)?.id).toBe(id)
  })

  it.each(['x', '1', 'Enter', ''])('%j picks nothing', (key) => {
    expect(rowForKey(rows, key)).toBeNull()
  })

  it('gives the standing grant of a helpers request no key', () => {
    expect(rowForKey(HELPERS_ROWS, 'y')?.id).toBe('allow')
    expect(rowForKey(HELPERS_ROWS, 'n')?.id).toBe('no')
    expect(rowForKey(HELPERS_ROWS, 'a')).toBeNull()
  })

  it('moves the highlight with the arrows, Home and End, and stops at the ends', () => {
    expect(movedHighlight(3, 0, 'ArrowDown')).toBe(1)
    expect(movedHighlight(3, 2, 'ArrowDown')).toBe(2)
    expect(movedHighlight(3, 0, 'ArrowUp')).toBe(0)
    expect(movedHighlight(3, 1, 'End')).toBe(2)
    expect(movedHighlight(3, 2, 'Home')).toBe(0)
    expect(movedHighlight(3, 1, 'y')).toBeNull()
    expect(movedHighlight(0, 0, 'ArrowDown')).toBeNull()
  })
})
