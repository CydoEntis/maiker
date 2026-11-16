import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChecksTab } from './ChecksTab'
import { CheckSchema } from './checks'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }))

const failed = CheckSchema.parse({ name: 'test', command: 'cargo test', state: 'Failed', line_count: 2 })

beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(invoke).mockReset().mockResolvedValue('line-one\nFAIL\n')
})
afterEach(cleanup)

describe('a check’s output', () => {
  it('shows the output of a check that ran on this computer', async () => {
    render(<ChecksTab term={5} machine={0} checks={[failed]} onNotice={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Output' }))

    await waitFor(() => { expect(screen.getByLabelText('Output of test').textContent).toBe('line-one\nFAIL\n') })
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('check_output', { machine: 0, term: 5, name: 'test' })
  })

  it('says the output is local-only for a session on another machine, and never asks for it', () => {
    render(<ChecksTab term={5} machine={2} checks={[failed]} onNotice={vi.fn()} />)

    const output = screen.getByRole('button', { name: 'Output' })
    expect(output.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(output)

    expect(screen.getByRole('alert').textContent).toContain("A check's output is local-only")
    expect(vi.mocked(invoke)).not.toHaveBeenCalled()
  })
})
