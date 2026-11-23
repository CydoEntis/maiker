import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PullRequest, PullRequestsAnswer } from '@/api/pullRequests'
import type { PullElsewhere } from './model'
import { PullRequestsSurface } from './PullRequestsSurface'

function pull(number: number, more: Partial<PullRequest> = {}): PullRequest {
  return { number, url: `https://github.com/o/r/pull/${String(number)}`, title: `Change ${String(number)}`, author: 'someone', branch: 'work', draft: false, checks: 'none', review: 'none', conflicting: false, mine: false, reviewRequested: false, needsYou: false, updatedAt: '', ...more }
}

function show(answer: PullRequestsAnswer | null, more: { loading?: boolean; elsewhere?: PullElsewhere[]; signIn?: boolean } = {}) {
  const actions = { onOpen: vi.fn(), onRetry: vi.fn(), onSignIn: vi.fn() }
  render(<PullRequestsSurface pulls={{ answer, loading: more.loading ?? false }} where="this computer" elsewhere={more.elsewhere ?? []} onOpen={actions.onOpen} onRetry={actions.onRetry} onSignIn={more.signIn === false ? undefined : actions.onSignIn} />)
  return actions
}
const rows = (list: HTMLElement) => within(list).getAllByRole('button')

describe('the Pull requests surface', () => {
  it('lists the open pull requests with the ones that need you first, and marks them', () => {
    show({ state: 'listed', login: 'me', more: false, items: [pull(142), pull(139, { needsYou: true, reviewRequested: true }), pull(137)] })

    const listed = rows(screen.getByRole('list', { name: 'Pull requests' }))
    expect(listed.map((row) => /#(\d+)/.exec(row.textContent)?.[1])).toEqual(['139', '142', '137'])
    expect(listed[0]).toHaveAccessibleName(/needs you/i)
    expect(listed[1]).not.toHaveAccessibleName(/needs you/i)
    expect(listed[2]).not.toHaveAccessibleName(/needs you/i)
  })

  it('opens a pull request in the browser when its row is pressed', async () => {
    const actions = show({ state: 'listed', login: 'me', more: false, items: [pull(7)] })

    await userEvent.click(screen.getByRole('button', { name: /#7/ }))

    expect(actions.onOpen).toHaveBeenCalledWith('https://github.com/o/r/pull/7')
  })

  it('says so in words, with nothing to press, whenever there is no list and nothing the person can do here', () => {
    const quiet: Array<PullRequestsAnswer | null> = [null, { state: 'listed', login: 'me', more: false, items: [] }, { state: 'not-installed' }, { state: 'not-on-github' }]
    for (const answer of quiet) {
      const { unmount } = render(<PullRequestsSurface pulls={{ answer, loading: answer === null }} where="this computer" elsewhere={[]} onOpen={vi.fn()} onRetry={vi.fn()} onSignIn={vi.fn()} />)

      expect(screen.getByRole('status')).not.toBeEmptyDOMElement()
      expect(screen.queryByRole('list')).not.toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('offers the sign-in when nobody is signed in, where one can be started', async () => {
    const actions = show({ state: 'not-signed-in' })

    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(actions.onSignIn).toHaveBeenCalledOnce()
  })

  it('offers no sign-in where none can be started', () => {
    show({ state: 'not-signed-in' }, { signIn: false })

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('gives the reason for a failure and asks again on Try again', async () => {
    const actions = show({ state: 'failed', why: 'error connecting to api.github.com' })

    expect(screen.getByRole('status')).toHaveTextContent('error connecting to api.github.com')
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(actions.onRetry).toHaveBeenCalledOnce()
  })

  it('lists what needs you in the other projects under its own heading, whatever this project said', async () => {
    const actions = show({ state: 'not-on-github' }, { elsewhere: [{ project: 'api-server', pull: pull(12, { needsYou: true, reviewRequested: true }) }] })

    const elsewhere = screen.getByRole('region', { name: /other projects/i })
    const row = within(elsewhere).getByRole('button', { name: /#12/ })
    expect(row).toHaveTextContent('api-server')
    await userEvent.click(row)

    expect(actions.onOpen).toHaveBeenCalledWith('https://github.com/o/r/pull/12')
  })
})
