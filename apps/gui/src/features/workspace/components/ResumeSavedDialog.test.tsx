import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const saved = vi.hoisted(() => ({ read: vi.fn<(agent: string, folder: string) => Promise<{ id: string; first_message: string; title?: string | null; last_active: number }[] | null>>() }))
vi.mock('@/api/daemon', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/daemon')>()), savedConversations: (agent: string, folder: string) => saved.read(agent, folder) }))

import { ResumeSavedDialog } from './ResumeSavedDialog'

const PROJECTS = [{ folder: '/dev/growth', name: 'growth', color: 'teal' }, { folder: '/dev/api', name: 'api', color: 'blue' }]

describe('Resume a saved chat', () => {
  it('lists what the agent saved for the folder and resumes the one picked', async () => {
    saved.read.mockImplementation((agent, folder) => Promise.resolve(agent === 'codex' && folder === '/dev/growth' ? [{ id: 'abc-1', first_message: 'Fix the login', title: 'Login bug', last_active: 1 }] : []))
    const onPick = vi.fn()
    render(<div className="mx-app"><ResumeSavedDialog projects={PROJECTS} defaultAgent="claude" locked={false} onPick={onPick} onCancel={() => undefined} /></div>)
    expect(await screen.findByText('No conversation saved for this folder yet.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Codex' }))
    const list = await screen.findByRole('list', { name: 'Saved conversations' })
    await userEvent.click(within(list).getByRole('button', { name: /Login bug/ }))
    expect(onPick).toHaveBeenCalledWith({ folder: '/dev/growth', agent: 'codex', id: 'abc-1', name: 'Login bug', lastActive: 1 })
  })

  it('says when the service is too old to list them', async () => {
    saved.read.mockResolvedValue(null)
    render(<div className="mx-app"><ResumeSavedDialog projects={PROJECTS} defaultAgent="claude" locked={false} onPick={() => undefined} onCancel={() => undefined} /></div>)
    expect(await screen.findByText('The Maiker service needs a restart to see saved conversations.')).toBeInTheDocument()
  })
})
