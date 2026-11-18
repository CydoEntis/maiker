import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isDesktop, openLink } from '@/api/daemon'
import { copyText } from '@/lib/clipboard'
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

const TABLE = '| Name | Qty | Note |\n| :--- | ---: | :---: |\n| `a` | **1** | x |\n| b | 22 | y |'

describe('a table in a message', () => {
  it('is a table with column headers and one cell per column', () => {
    render(<Markdown text={TABLE} />)

    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Name', 'Qty', 'Note'])
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(within(table).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['a', '1', 'x', 'b', '22', 'y'])
  })

  it('reads inline markdown in a cell and aligns a column as asked', () => {
    render(<Markdown text={TABLE} />)

    expect(screen.getByText('1').tagName).toBe('STRONG')
    expect(screen.getByText('a').tagName).toBe('CODE')
    expect(screen.getByRole('columnheader', { name: 'Qty' })).toHaveClass('text-right')
    expect(screen.getByRole('columnheader', { name: 'Note' })).toHaveClass('text-center')
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveClass('text-left')
  })

  it('scrolls inside a named region that the keyboard can reach, so a wide table never widens the message', () => {
    render(<Markdown text={TABLE} />)

    const region = screen.getByRole('region', { name: 'Table' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(region).toHaveClass('overflow-x-auto', 'max-w-full')
    expect(within(region).getByRole('table')).toBeInTheDocument()
  })

  it('keeps its Copy and Save in a head above the table, inside the same card, never loose under it', () => {
    render(<Markdown text={TABLE + '\n\nAfter.'} />)

    const actions = screen.getByRole('group', { name: 'Copy or save this table' })
    const region = screen.getByRole('region', { name: 'Table' })
    expect(actions.parentElement).toBe(region.parentElement)
    expect(actions.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(actions).getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it('shows markup in a cell as text', () => {
    const { container } = render(<Markdown text={'| h |\n|---|\n| <img src=x onerror=alert(1)> |'} />)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByRole('cell')).toHaveTextContent('<img src=x onerror=alert(1)>')
  })

  it('leaves text around it as paragraphs', () => {
    render(<Markdown text={'Before.\n\n' + TABLE + '\n\nAfter.'} />)

    expect(screen.getByText('Before.')).toBeInTheDocument()
    expect(screen.getByText('After.')).toBeInTheDocument()
    expect(screen.getAllByRole('table')).toHaveLength(1)
  })
})

describe('a task list', () => {
  it('shows read-only checkboxes named by their text, ticked where done, and nests', () => {
    render(<Markdown text={'- [x] done\n- [ ] open\n  - [x] nested\n- plain'} />)
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(3)
    expect(boxes.map((box) => box.getAttribute('aria-checked'))).toEqual(['true', 'false', 'true'])
    expect(boxes.every((box) => box.getAttribute('aria-readonly') === 'true')).toBe(true)
    expect(screen.getByRole('checkbox', { name: 'open' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'nested' })).toBeInTheDocument()
  })

  it('leaves [ ] in a sentence plain text', () => {
    render(<Markdown text="Use [ ] to mean open." />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('Use [ ] to mean open.')).toBeInTheDocument()
  })
})
