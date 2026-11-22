import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isDesktop, openLink } from '@/api/daemon'
import { copyText } from '@/lib/clipboard'
import { OpenFileContext } from '../openFile'
import { Markdown } from './Markdown'

vi.mock('@/api/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/daemon')>()),
  isDesktop: vi.fn(() => false),
  openLink: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/clipboard', () => ({ copyText: vi.fn(() => Promise.resolve()) }))

describe('a link in a message', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('opens in the person\'s own browser when it is clicked in the desktop app, and is never an anchor', async () => {
    vi.mocked(isDesktop).mockReturnValue(true)
    const user = userEvent.setup()
    const { container } = render(<Markdown text="See [the docs](https://example.com/a?b=1&c=2)." />)

    await user.click(screen.getByRole('button', { name: 'the docs' }))

    expect(openLink).toHaveBeenCalledExactlyOnceWith('https://example.com/a?b=1&c=2')
    expect(copyText).not.toHaveBeenCalled()
    expect(container.querySelector('a')).toBeNull()
  })

  it('copies its address outside the desktop app, where there is no browser to hand it to', async () => {
    vi.mocked(isDesktop).mockReturnValue(false)
    const user = userEvent.setup()
    render(<Markdown text="See [the docs](https://example.com/)." />)

    await user.click(screen.getByRole('button', { name: 'the docs' }))

    await waitFor(() => { expect(copyText).toHaveBeenCalledExactlyOnceWith('https://example.com/') })
    expect(openLink).not.toHaveBeenCalled()
  })

  it('opens a web address written as code or bare, and leaves other code alone', async () => {
    vi.mocked(isDesktop).mockReturnValue(true)
    const user = userEvent.setup()
    render(<Markdown text="Open `https://entra.microsoft.com` or https://example.com/x, then run `npm test` and `javascript:alert(1)`." />)

    await user.click(screen.getByRole('button', { name: 'https://entra.microsoft.com' }))
    await user.click(screen.getByRole('button', { name: 'https://example.com/x' }))

    expect(vi.mocked(openLink).mock.calls).toEqual([['https://entra.microsoft.com/'], ['https://example.com/x']])
    expect(screen.queryByRole('button', { name: 'npm test' })).toBeNull()
    expect(screen.queryByRole('button', { name: /javascript/ })).toBeNull()
  })
})

describe('a table in a message', () => {

  it('shows markup in a cell as text', () => {
    const { container } = render(<Markdown text={'| h |\n|---|\n| <img src=x onerror=alert(1)> |'} />)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByRole('cell')).toHaveTextContent('<img src=x onerror=alert(1)>')
  })
})

describe('a file name in a message', () => {

  it('opens the file at its line when the chat can open files, still without a badge', async () => {
    const open = vi.fn()
    const user = userEvent.setup()
    const { container } = render(<OpenFileContext.Provider value={open}><Markdown text="See `src/tax.js:42`." /></OpenFileContext.Provider>)

    await user.click(screen.getByRole('button', { name: 'src/tax.js:42' }))

    expect(open).toHaveBeenCalledExactlyOnceWith('src/tax.js', 42)
    expect(container.querySelector('[data-slot="file-badge"]')).toBeNull()
  })
})

describe('a code block in a message', () => {
  const fence = (language: string, lines: readonly string[]) => `\`\`\`${language}\n${lines.join('\n')}\n\`\`\``
  const numbered = (count: number) => Array.from({ length: count }, (_, index) => `line ${String(index + 1)}`)

  it('colours a diff fence line by line, by its sign', () => {
    const { container } = render(<Markdown text={fence('diff', ['@@ -1,2 +1,2 @@', ' keep', '-  return a', '+  return b'])} />)
    const kinds = Array.from(container.querySelectorAll('.code-line')).map((line) => line.className.replace('code-line', '').trim())
    expect(kinds).toEqual(['is-hunk', '', 'is-del', 'is-add'])
  })

  it('stays whole as it is written past the fold, and folds only when it arrives long', () => {
    const watched = render(<Markdown text={fence('ts', numbered(5))} />)
    watched.rerender(<Markdown text={fence('ts', numbered(60))} />)
    expect(watched.container.querySelectorAll('.code-line')).toHaveLength(60)
    expect(screen.queryByRole('button', { name: /more lines/ })).not.toBeInTheDocument()
    watched.unmount()

    const arrived = render(<Markdown text={fence('ts', numbered(61))} />)
    expect(screen.getByRole('button', { name: /Show \d+ more lines/ })).toBeInTheDocument()
    expect(arrived.container.querySelectorAll('.code-line').length).toBeLessThan(61)
  })
})
