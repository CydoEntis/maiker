import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DocumentView } from './DocumentView'
import { fakeDisk } from './documentTestIO'
import type { DocumentIO } from './useDocument'

const open = (io: DocumentIO, extra: Partial<React.ComponentProps<typeof DocumentView>> = {}) =>
  render(<DocumentView term={3} machine={0} path="README.md" root="/project" onOpenPath={() => undefined} io={io} startMode="drawn" {...extra} />)

describe('the document viewer', () => {

  it('never runs the file: raw HTML is text, a javascript link is only its label, an image is not loaded', async () => {
    const { io } = fakeDisk('<script>window.__ran = true</script>\n\n<img src="x" onerror="window.__ran = true">\n\n[click](javascript:alert(1)) ![pic](https://example.test/p.png)\n')
    const { container } = open(io)
    await screen.findByText(/click/)
    expect(container.querySelector('script, img, iframe')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect((window as unknown as { __ran?: boolean }).__ran).toBeUndefined()
    expect(container.textContent).toContain('<script>window.__ran = true</script>')
    expect(screen.getByText(/click/).closest('button')).toBeNull()
  })

  it('draws a very large file without a link or an element it should not have', async () => {
    const big = `${'word '.repeat(60_000)}\n\n[ok](docs/a.md)\n`
    const { io } = fakeDisk(big)
    const { container } = open(io)
    await waitFor(() => { expect(container.textContent).toContain('ok') })
    expect(container.querySelector('script')).toBeNull()
  })

  it('opens a link to another markdown file of the project in the same viewer, and leaves web links to the browser path', async () => {
    const user = userEvent.setup()
    const onOpenPath = vi.fn()
    const { io } = fakeDisk('[the setup](docs/setup.md) and [up](../outside.md) and [bad](/etc/x.md)\n')
    open(io, { onOpenPath })
    await user.click(await screen.findByRole('button', { name: 'the setup' }))
    expect(onOpenPath).toHaveBeenCalledWith('docs/setup.md')
    await user.click(screen.getByRole('button', { name: 'up' }))
    expect(onOpenPath).toHaveBeenCalledTimes(1)
  })

  it('edits, saves with the version it read, and writes the file\'s own CRLF endings', async () => {
    const user = userEvent.setup()
    const { io, disk } = fakeDisk('# A\r\nb\r\n')
    open(io)
    await screen.findByRole('heading', { name: 'A' })
    await user.click(screen.getByRole('radio', { name: 'Edit' }))
    const box = screen.getByRole('textbox', { name: 'Edit README.md' })
    expect(box).toHaveValue('# A\nb\n')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.type(box, 'c')
    expect(screen.getByRole('img', { name: 'Unsaved changes' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(disk.text).toBe('# A\r\nb\r\nc') })
    expect(io.save).toHaveBeenCalledWith(3, 0, 'README.md', '# A\r\nb\r\nc', 'v1')
    expect(screen.queryByRole('img', { name: 'Unsaved changes' })).toBeNull()
  })

  it('saves with Ctrl+S', async () => {
    const user = userEvent.setup()
    const { io, disk } = fakeDisk('x\n')
    open(io, { startMode: 'edit' })
    const box = await screen.findByRole('textbox', { name: 'Edit README.md' })
    await user.type(box, 'y')
    fireEvent.keyDown(box, { key: 's', ctrlKey: true })
    await waitFor(() => { expect(disk.text).toBe('x\ny') })
    expect(io.save).toHaveBeenCalledTimes(1)
  })

  it('refuses a save over a file an agent changed, and offers Reload or Overwrite, never a silent overwrite', async () => {
    const user = userEvent.setup()
    const { io, disk, agentEdits } = fakeDisk('mine\n')
    open(io, { startMode: 'edit' })
    const box = await screen.findByRole('textbox', { name: 'Edit README.md' })
    await user.type(box, '!')
    agentEdits('the agent wrote this\n')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('changed on disk')
    expect(disk.text).toBe('the agent wrote this\n')
    await user.click(screen.getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => { expect(disk.text).toBe('mine\n!') })
    expect(io.save).toHaveBeenLastCalledWith(3, 0, 'README.md', 'mine\n!', null)
  })

  it('reloads the file\'s new text from a conflict, dropping the draft', async () => {
    const user = userEvent.setup()
    const { io, agentEdits } = fakeDisk('mine\n')
    open(io, { startMode: 'edit' })
    await user.type(await screen.findByRole('textbox', { name: 'Edit README.md' }), '!')
    agentEdits('# From the agent\n')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(await screen.findByRole('button', { name: 'Reload' }))
    expect(await screen.findByRole('heading', { name: 'From the agent' })).toBeInTheDocument()
  })

  it('says a failed save inline with Retry, and keeps the draft', async () => {
    const user = userEvent.setup()
    const { io } = fakeDisk('a\n')
    vi.mocked(io.save).mockRejectedValueOnce(new Error('Permission denied'))
    open(io, { startMode: 'edit' })
    const box = await screen.findByRole('textbox', { name: 'Edit README.md' })
    await user.type(box, 'b')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied')
    expect(box).toHaveValue('a\nb')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => { expect(io.save).toHaveBeenCalledTimes(2) })
  })

  it('says a failed read inline with Retry, and reads again on it', async () => {
    const user = userEvent.setup()
    const { io } = fakeDisk('# Back\n')
    vi.mocked(io.read).mockRejectedValueOnce(new Error('README.md is no longer there'))
    open(io)
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer there')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Back' })).toBeInTheDocument()
  })

  it('hands Close to its owner at once: the pane that closes it asks about the draft (draftGuard.test.tsx)', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { io } = fakeDisk('a\n')
    open(io, { startMode: 'edit', onClose })
    await user.type(await screen.findByRole('textbox', { name: 'Edit README.md' }), 'b')
    await user.click(screen.getByRole('button', { name: 'Close README.md' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('offers no Edit for a file the daemon cannot save with a version check, and says why', async () => {
    const { io } = fakeDisk('a\n')
    vi.mocked(io.read).mockResolvedValue({ text: 'a\n', version: null })
    open(io)
    await screen.findByRole('radio', { name: 'Source' })
    expect(screen.queryByRole('radio', { name: 'Edit' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('This computer’s service is older: restart it to edit.')
  })

  it('reads a document of another machine, saves it there with the version it read, and names an older service in its words', async () => {
    const user = userEvent.setup()
    const { io } = fakeDisk('a\n')
    const { unmount } = open(io, { machine: 2, startMode: 'edit' })
    await user.type(await screen.findByRole('textbox', { name: 'Edit README.md' }), 'b')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(io.read).toHaveBeenCalledWith(3, 2, 'README.md')
    expect(io.save).toHaveBeenCalledWith(3, 2, 'README.md', expect.stringContaining('b'), 'v1')
    unmount()
    vi.mocked(io.read).mockResolvedValue({ text: 'a\n', version: null })
    open(io, { machine: 2 })
    await screen.findByRole('radio', { name: 'Source' })
    expect(screen.getByRole('status')).toHaveTextContent('This machine’s service is older: restart it to edit.')
  })

  it('shows a document whose text had to be cleaned, but offers no Edit (saving it would change the file)', async () => {
    const { io } = fakeDisk('a\n')
    vi.mocked(io.read).mockResolvedValue({ text: 'a\n', version: '' })
    open(io, { machine: 2 })
    await screen.findByRole('radio', { name: 'Source' })
    expect(screen.queryByRole('radio', { name: 'Edit' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('read only here')
  })

  it('takes a change made on disk by something else quietly when no draft is open', async () => {
    const { io, agentEdits } = fakeDisk('# Old\n')
    open(io)
    await screen.findByRole('heading', { name: 'Old' })
    agentEdits('# New\n')
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(await screen.findByRole('heading', { name: 'New' })).toBeInTheDocument()
  })

  it('tells a person who is editing that the file changed, without touching the draft', async () => {
    const user = userEvent.setup()
    const { io, agentEdits } = fakeDisk('a\n')
    open(io, { startMode: 'edit' })
    const box = await screen.findByRole('textbox', { name: 'Edit README.md' })
    await user.type(box, 'b')
    agentEdits('agent\n')
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(await screen.findByRole('status')).toHaveTextContent('changed on disk')
    expect(box).toHaveValue('a\nb')
  })
})
