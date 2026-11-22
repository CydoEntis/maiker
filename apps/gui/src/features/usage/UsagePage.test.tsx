import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsagePeriod, UsageReport } from '@/api/usage'
import { UsagePage } from './UsagePage'

const api = vi.hoisted(() => ({ loadUsageReport: vi.fn<(period: UsagePeriod) => Promise<UsageReport>>() }))
vi.mock('@/api/usage', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/usage')>()), loadUsageReport: api.loadUsageReport }))

const NONE = { tokensIn: null, tokensOut: null, cost: null, turns: 0, workingSecs: 0 }

function report(overrides: Partial<UsageReport> = {}): UsageReport {
  return {
    period: 'Week',
    from: '2026-10-29',
    to: '2026-11-04',
    retentionDays: 90,
    totals: { tokensIn: 1200, tokensOut: 300, cost: 0.75, turns: 4, workingSecs: 600 },
    sessionCount: 2,
    sessionsWithoutCost: 1,
    sessions: [
      { session: 'aaaaaaaa-1', term: 3, agent: 'claude', project: 'shop', firstDay: '2026-11-03', lastDay: '2026-11-04', tokensIn: 1000, tokensOut: 200, cost: 0.75, turns: 3, workingSecs: 500 },
      { session: 'bbbbbbbb-2', term: null, agent: 'codex', project: 'api', firstDay: '2026-11-04', lastDay: '2026-11-03', ...NONE, tokensIn: 200, tokensOut: 100, turns: 1, workingSecs: 100 },
    ],
    days: [{ day: '2026-11-04', tokensIn: 1200, tokensOut: 300, cost: 0.75, turns: 4, workingSecs: 600 }],
    ...overrides,
  }
}

type Props = Partial<React.ComponentProps<typeof UsagePage>>

function renderPage(props: Props = {}) {
  const handlers = { onBudget: vi.fn(), onOpenSession: vi.fn() }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <UsagePage budget={null} sessionForTerm={(term) => (term === 3 ? { id: 't3', name: 'Shop agent' } : null)} {...handlers} {...props} />
    </QueryClientProvider>,
  )
  return handlers
}

const ready = () => screen.findByRole('table', { name: /Sessions in this period/ })
const sessionsTable = () => screen.getByRole('table', { name: /Sessions in this period/ })
const rowsOf = () => within(sessionsTable()).getAllByRole('row').slice(1, -1)

beforeEach(() => {
  api.loadUsageReport.mockReset()
  api.loadUsageReport.mockResolvedValue(report())
})

describe('usage page states', () => {

  it('says it could not load, in words, and retries on request', async () => {
    api.loadUsageReport.mockRejectedValueOnce(new Error('socket: connection refused'))
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load usage')
    expect(alert).not.toHaveTextContent('connection refused')

    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await ready()).toBeInTheDocument()
    expect(api.loadUsageReport).toHaveBeenCalledTimes(2)
  })
})

describe('usage page period', () => {
  it('asks again when the period changes and names the rolling window honestly', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText(/Last 7 days/)).toBeInTheDocument()
    expect(api.loadUsageReport).toHaveBeenLastCalledWith('week')

    await user.click(screen.getByRole('button', { name: 'Month' }))
    await waitFor(() => { expect(api.loadUsageReport).toHaveBeenLastCalledWith('month') })
    expect(await screen.findByText(/Last 30 days/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(await screen.findByText(/Today \(UTC\)/)).toBeInTheDocument()
  })
})

describe('usage page figures', () => {
  it('shows a dash for every null and no dollar total when no cost was reported', async () => {
    api.loadUsageReport.mockResolvedValue(report({
      totals: { tokensIn: null, tokensOut: null, cost: null, turns: 2, workingSecs: 60 },
      sessionsWithoutCost: 2,
      sessions: [{ session: 'cccccccc-3', term: null, agent: 'codex', project: 'api', firstDay: '2026-11-04', lastDay: '2026-11-04', ...NONE, turns: 2, workingSecs: 60 }],
      sessionCount: 1,
      days: [],
    }))
    renderPage()
    await ready()
    expect(document.body.textContent).not.toMatch(/\$\d/)
    const cost = screen.getByText('Cost', { selector: 'p' }).parentElement
    expect(cost).toHaveTextContent('—')
    expect(within(rowsOf()[0] as HTMLElement).getAllByText('—')).toHaveLength(3)
  })
})

describe('usage table', () => {

  it('starts text columns A to Z, flips on a second press, and works from the keyboard', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()
    const project = within(within(sessionsTable()).getByRole('columnheader', { name: 'Project' })).getByRole('button')
    project.focus()
    await user.keyboard('{Enter}')
    expect(within(sessionsTable()).getByRole('columnheader', { name: 'Project' })).toHaveAttribute('aria-sort', 'ascending')
    expect(rowsOf()[0]).toHaveTextContent('api')
    await user.keyboard(' ')
    expect(within(sessionsTable()).getByRole('columnheader', { name: 'Project' })).toHaveAttribute('aria-sort', 'descending')
    expect(rowsOf()[0]).toHaveTextContent('shop')
  })

  it('opens the pane of a row whose session is still open', async () => {
    const user = userEvent.setup()
    const { onOpenSession } = renderPage()
    await ready()
    await user.click(screen.getByRole('button', { name: 'Shop agent' }))
    expect(onOpenSession).toHaveBeenCalledWith('t3')

    await user.click(rowsOf()[0] as HTMLElement)
    expect(onOpenSession).toHaveBeenCalledTimes(2)
  })

  it('does not link a closed session', async () => {
    const user = userEvent.setup()
    const { onOpenSession } = renderPage()
    await ready()
    const closed = rowsOf()[1] as HTMLElement
    expect(within(closed).queryByRole('button')).not.toBeInTheDocument()
    await user.click(closed)
    expect(onOpenSession).not.toHaveBeenCalled()
  })
})

describe('usage page budget', () => {

  it('saves a valid amount and refuses a bad one', async () => {
    const user = userEvent.setup()
    const { onBudget } = renderPage()
    await user.click(await screen.findByRole('button', { name: 'Set a monthly budget' }))
    const box = screen.getByRole('textbox', { name: /Monthly budget/ })
    await user.type(box, 'lots')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an amount in dollars')
    expect(onBudget).not.toHaveBeenCalled()

    await user.clear(box)
    await user.type(box, '$50')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onBudget).toHaveBeenCalledWith(50)
  })

  it('clears the budget with No budget', async () => {
    const user = userEvent.setup()
    const { onBudget } = renderPage({ budget: 50 })
    await user.click(await screen.findByRole('button', { name: 'Change' }))
    await user.click(screen.getByRole('button', { name: 'No budget' }))
    expect(onBudget).toHaveBeenCalledWith(null)
  })

  it('draws the ring only on the month, with a budget and a known cost', async () => {
    const user = userEvent.setup()
    renderPage({ budget: 1 })
    await ready()
    expect(screen.queryByRole('img', { name: /monthly budget used/ })).not.toBeInTheDocument()
    expect(screen.getByText('Choose Month to compare')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Month' }))
    expect(await screen.findByRole('img', { name: '75% of the $1.00 monthly budget used' })).toBeInTheDocument()
  })
})
