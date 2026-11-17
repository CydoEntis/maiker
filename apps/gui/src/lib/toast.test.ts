import { beforeEach, describe, expect, it, vi } from 'vitest'

const custom = vi.hoisted(() => vi.fn(() => 'shown'))
vi.mock('sonner', () => ({ toast: { custom, dismiss: vi.fn() } }))

import { toast } from './toast'

describe('toast.error', () => {
  beforeEach(() => { custom.mockClear() })

  it('stays quiet when the only news is that the window has no line to the service', () => {
    toast.error('The terminal is not connected to the daemon')

    expect(custom).not.toHaveBeenCalled()
  })

  it('shows every other failure', () => {
    toast.error('Could not copy the selection')

    expect(custom).toHaveBeenCalledTimes(1)
  })
})

describe('toast.failure', () => {
  beforeEach(() => { custom.mockClear() })

  const shown = () => {
    const [render] = custom.mock.calls[0] as unknown as [(id: string) => { props: { title: string; options: { description?: string; action?: { label: string } } } }]
    return render('t').props
  }

  it('titles the toast with what failed and says why in plain words, with Copy details for the raw text', () => {
    toast.failure('Permission denied (os error 13)', 'Could not save the file')

    const { title, options } = shown()
    expect(title).toBe('Could not save the file')
    expect(options.description).toMatch(/^Maiker is not allowed/)
    expect(options.action?.label).toBe('Copy details')
  })

  it('has no Copy details when the reason is the whole story', () => {
    toast.failure(new Error('The branch is checked out in another worktree.'), 'Could not switch branch')

    expect(shown().options.action).toBeUndefined()
  })

  it('stays quiet when the failure is only that the window has no line to the service', () => {
    toast.failure('The terminal is not connected to the daemon', 'Could not send')

    expect(custom).not.toHaveBeenCalled()
  })
})
