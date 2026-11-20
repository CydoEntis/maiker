import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_NAME } from '@/brand'
import { currentToasts, holdToasts, readingToasts, resetToasts, toast, TOAST_HIDE_MS } from './toast'

const shown = () => currentToasts().items

describe('the toast store', () => {
  beforeEach(() => { vi.useFakeTimers(); resetToasts() })
  afterEach(() => { resetToasts(); vi.useRealTimers() })

  it('hides a success or a note after five seconds, and keeps a failure, a warning, a needs-you and a progress toast', () => {
    toast.success('Copied')
    toast.info('Put away Parser fix')
    toast.error('Could not save the file')
    toast.warning('devbox is on an older version')
    toast.needs('Parser fix needs you')
    toast.progress('Sending a.png to devbox')
    vi.advanceTimersByTime(TOAST_HIDE_MS - 1)
    expect(shown()).toHaveLength(6)
    vi.advanceTimersByTime(1)
    expect(shown().map((item) => item.kind)).toEqual(['progress', 'needs', 'warning', 'error'])
    vi.advanceTimersByTime(TOAST_HIDE_MS * 10)
    expect(shown()).toHaveLength(4)
  })

  it('keeps a context line, the project or machine, and leaves it off when none is given', () => {
    toast.info('Put away Parser fix', { context: 'chameleon' })
    toast.info('Copied', { context: '' })
    expect(shown()[1]).toMatchObject({ context: 'chameleon' })
    expect(shown()[0]).not.toHaveProperty('context')
  })

  it('puts the newest first', () => {
    toast.error('First')
    toast.error('Second')
    expect(shown().map((item) => item.title)).toEqual(['Second', 'First'])
  })

  it('merges a second failure of the same kind into the first, with a count, instead of stacking', () => {
    const first = toast.error('Could not start the session')
    const second = toast.error('Could not start the session')
    expect(second).toBe(first)
    expect(shown()).toHaveLength(1)
    expect(shown()[0]?.count).toBe(2)
  })

  it('names a merged group by its own words when asked', () => {
    const merge = { key: 'start', title: (count: number) => (count === 1 ? 'A chat could not start' : `${String(count)} chats could not start`) }
    toast.error('ignored', { merge })
    toast.error('ignored', { merge })
    expect(shown()[0]).toMatchObject({ title: '2 chats could not start', count: 2, countInTitle: true })
  })

  it('replaces a toast by its id in place, as a progress toast becomes its outcome', () => {
    toast.progress('Sending a.png', { id: 'send-1' })
    toast.error('Other')
    toast.success('Sent a.png', { id: 'send-1' })
    expect(shown().map((item) => [item.id, item.kind])).toEqual([['toast-2', 'error'], ['send-1', 'success']])
    vi.advanceTimersByTime(TOAST_HIDE_MS)
    expect(shown().map((item) => item.id)).toEqual(['toast-2'])
  })

  it('stays while it is being read, and hides the rest of its time after', () => {
    toast.success('Copied')
    vi.advanceTimersByTime(TOAST_HIDE_MS - 1000)
    readingToasts(true)
    vi.advanceTimersByTime(TOAST_HIDE_MS * 3)
    expect(shown()).toHaveLength(1)
    readingToasts(false)
    vi.advanceTimersByTime(999)
    expect(shown()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(shown()).toHaveLength(0)
  })

  it('holds every toast while the window is offline: none shows and none runs out', () => {
    toast.success('Copied')
    holdToasts(true)
    expect(currentToasts().held).toBe(true)
    vi.advanceTimersByTime(TOAST_HIDE_MS * 2)
    expect(shown()).toHaveLength(1)
    holdToasts(false)
    vi.advanceTimersByTime(TOAST_HIDE_MS)
    expect(shown()).toHaveLength(0)
  })

  it('stays quiet when the only news is that the window has no line to the service', () => {
    toast.error('The terminal is not connected to the daemon')
    toast.failed('Could not send', new Error('The terminal is not connected to the daemon'))
    expect(shown()).toHaveLength(0)
  })

  it('says what failed in the title and the error\'s own words as the reason and behind Copy details', () => {
    toast.failed('Could not open the link', new Error('xdg-open exited with code 3'))
    // A raw tool message is made one sentence; its own text stays behind Copy details.
    expect(shown()[0]).toMatchObject({ kind: 'error', title: 'Could not open the link', description: 'Xdg-open exited with code 3.', details: 'xdg-open exited with code 3' })
  })

  it('dismisses one toast, or all', () => {
    const id = toast.error('One')
    toast.error('Two')
    toast.dismiss(id)
    expect(shown().map((item) => item.title)).toEqual(['Two'])
    toast.dismiss()
    expect(shown()).toHaveLength(0)
  })
})

describe('toast.failed', () => {
  beforeEach(() => { resetToasts() })
  afterEach(() => { resetToasts() })

  it('titles the toast with what failed and says why in plain words, with Copy details for the raw text', () => {
    toast.failed('Could not save the file', 'Permission denied (os error 13)')

    expect(shown()[0]).toMatchObject({ title: 'Could not save the file', details: 'Permission denied (os error 13)' })
    expect(shown()[0]?.description).toMatch(new RegExp(`^${APP_NAME} is not allowed`))
  })

  it('has no Copy details when the reason is the whole story', () => {
    toast.failed('Could not switch branch', new Error('The branch is checked out in another worktree.'))

    expect(shown()[0]).toMatchObject({ description: 'The branch is checked out in another worktree.' })
    expect(shown()[0]?.details).toBeUndefined()
  })

  it('stays quiet when the failure is only that the window has no line to the service', () => {
    toast.failed('Could not send', 'The terminal is not connected to the daemon')

    expect(shown()).toHaveLength(0)
  })
})
