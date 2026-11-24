import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticsPreview } from '@/api/diagnostics'
import { ExportLogsCard } from './ExportLogsCard'

const mocks = vi.hoisted(() => ({
  prepareDiagnostics: vi.fn<() => Promise<DiagnosticsPreview>>(),
  saveDiagnostics: vi.fn<() => Promise<string | null>>(),
  copyText: vi.fn<(text: string) => Promise<void>>(),
  success: vi.fn(),
  failed: vi.fn(),
}))

vi.mock('@/api/diagnostics', () => ({ prepareDiagnostics: mocks.prepareDiagnostics, saveDiagnostics: mocks.saveDiagnostics }))
vi.mock('@/lib/clipboard', () => ({ copyText: mocks.copyText }))
vi.mock('@/lib/toast', () => ({ toast: { success: mocks.success, failed: mocks.failed } }))

const PREVIEW: DiagnosticsPreview = {
  parts: [
    { title: 'Versions, system and service status', included: true, note: '6 lines' },
    { title: 'Service log (recent)', included: false, note: 'Left out: there is no service log yet' },
  ],
  summary: 'Maiker app 1.2.3 | service 1.2.0',
  text: 'Maiker diagnostics\nApp version: 1.2.3',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prepareDiagnostics.mockResolvedValue(PREVIEW)
  mocks.copyText.mockResolvedValue()
})

describe('ExportLogsCard', () => {
  it('shows nothing of the bundle until the person asks for a preview', () => {
    render(<ExportLogsCard />)
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Save file' })).toBeNull()
  })

  it('lists each part, says what was left out and why, and shows the exact text', async () => {
    render(<ExportLogsCard />)
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))

    expect(await screen.findByText('Versions, system and service status')).toBeInTheDocument()
    expect(screen.getByText('Left out: there is no service log yet')).toBeInTheDocument()
    expect(screen.getByLabelText('The exact text that will be saved')).toHaveTextContent('App version: 1.2.3')
  })

  it('disables the button while reading', async () => {
    mocks.prepareDiagnostics.mockReturnValue(new Promise(() => {}))
    render(<ExportLogsCard />)
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByRole('button', { name: 'Reading…' })).toBeDisabled()
  })

  it('says so and goes back to Preview when reading fails', async () => {
    mocks.prepareDiagnostics.mockRejectedValue(new Error('disk'))
    render(<ExportLogsCard />)
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))

    expect(await screen.findByRole('button', { name: 'Preview' })).toBeEnabled()
    expect(mocks.failed).toHaveBeenCalledWith('Could not read the logs', expect.any(Error))
  })

  it('copies the summary and saves the file, telling where it went', async () => {
    mocks.saveDiagnostics.mockResolvedValue('/tmp/maiker-diagnostics.txt')
    render(<ExportLogsCard />)
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Copy summary' }))
    expect(mocks.copyText).toHaveBeenCalledWith(PREVIEW.summary)

    await userEvent.click(screen.getByRole('button', { name: 'Save file' }))
    expect(mocks.success).toHaveBeenCalledWith('Logs saved', { description: '/tmp/maiker-diagnostics.txt' })
  })

  it('says nothing when the save dialog is closed', async () => {
    mocks.saveDiagnostics.mockResolvedValue(null)
    render(<ExportLogsCard />)
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Save file' }))

    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.failed).not.toHaveBeenCalled()
  })
})
