import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { ReferencesTab } from './ReferencesTab'

vi.mock('./api', () => ({ repoReferences: vi.fn(() => Promise.resolve([])) }))

describe('ReferencesTab', () => {
  it('says what references are for when there are none', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ReferencesTab term={1} /></QueryClientProvider>)
    expect(await screen.findByText('Show agents what to build')).toBeTruthy()
    expect(screen.getByText(/kept on this computer, not in git/)).toBeTruthy()
  })
})
