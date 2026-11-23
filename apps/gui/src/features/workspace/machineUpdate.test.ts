import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateMachine } from '@/api/machines'
import { runMachineUpdate } from './machineUpdate'

const toasts = vi.hoisted(() => ({ failed: vi.fn(), progress: vi.fn(() => 'toast-1'), success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: toasts }))
vi.mock('@/api/machines', async (importOriginal) => ({ ...await importOriginal<typeof import('@/api/machines')>(), updateMachine: vi.fn() }))

beforeEach(() => { vi.clearAllMocks() })

describe('installing or updating a machine', () => {
  it('passes --install for a machine with none, says it is running, then how it ended, and dials it again', async () => {
    vi.mocked(updateMachine).mockResolvedValue('box: maiker 0.67.0 installed to ~/.local/bin/maiker')
    const onDone = vi.fn()
    await runMachineUpdate('box', 'install', false, { onDone, onRestartAnyway: vi.fn() })
    expect(updateMachine).toHaveBeenCalledWith('box', true, false)
    expect(toasts.progress).toHaveBeenCalledWith('Installing Maiker on box…')
    expect(toasts.success).toHaveBeenCalledWith('box: maiker 0.67.0 installed to ~/.local/bin/maiker', { id: 'toast-1' })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('replaces another version without --install, and keeps the daemon note it gave', async () => {
    vi.mocked(updateMachine).mockResolvedValue('box: maiker 0.67.0 is already up to date\nnote: could not ask the Maiker service (x); running sessions are untouched')
    await runMachineUpdate('box', 'update', true, { onDone: vi.fn(), onRestartAnyway: vi.fn() })
    expect(updateMachine).toHaveBeenCalledWith('box', false, true)
    expect(toasts.success).toHaveBeenCalledWith('box: maiker 0.67.0 is already up to date', { id: 'toast-1', description: 'note: could not ask the Maiker service (x); running sessions are untouched' })
  })

  it.each([
    ['a newer version there', 'maiker: box has a newer maiker than this one; update this computer, or run `maiker machine update box --force` to downgrade it', 'box has a newer maiker than this one; update this computer, or run `maiker machine update box --force` to downgrade it'],
    ['ssh that cannot get in', 'could not reach box: Permission denied; make plain `ssh` to that machine work in a terminal, then retry', 'could not reach box: Permission denied; make plain `ssh` to that machine work in a terminal, then retry'],
    ['a Windows machine', 'maiker: Windows machines are not supported as a remote in v1', 'Windows machines are not supported as a remote in v1'],
  ])('says why it did not, for %s, and does not dial it again', async (_case, said, shown) => {
    vi.mocked(updateMachine).mockRejectedValue(said)
    const onDone = vi.fn()
    await runMachineUpdate('box', 'update', false, { onDone, onRestartAnyway: vi.fn() })
    expect(toasts.error).toHaveBeenCalledWith('Could not update Maiker on box', { id: 'toast-1', description: shown })
    expect(onDone).not.toHaveBeenCalled()
  })

  it('offers Restart anyway, with the sessions it would end, when the old service refused to restart', async () => {
    vi.mocked(updateMachine).mockRejectedValue('The service on box was not restarted (4 open session(s); it keeps them), so it still runs the old Maiker and this app cannot connect to it.')
    const onRestartAnyway = vi.fn()
    await runMachineUpdate('box', 'update', false, { onDone: vi.fn(), onRestartAnyway })
    const shown = toasts.error.mock.calls[0]?.[1] as { action: { label: string; onClick: () => void }; duration: number }
    expect(shown.action.label).toBe('Restart anyway…')
    expect(shown.duration).toBe(Infinity)
    shown.action.onClick()
    expect(onRestartAnyway).toHaveBeenCalledWith(4)
  })
})
