import { describe, expect, it } from 'vitest'
import type { PullRequest, PullRequestsAnswer } from '@/api/pullRequests'
import { explainPullsFailure, needsYouCount, needsYouElsewhere, needsYouIn, orderPulls, pullsKey, pullStanding, type ProjectPulls } from './model'

function pull(number: number, more: Partial<PullRequest> = {}): PullRequest {
  return { number, url: `https://github.com/o/r/pull/${String(number)}`, title: `Change ${String(number)}`, author: 'someone', branch: 'work', draft: false, checks: 'none', review: 'none', conflicting: false, mine: false, reviewRequested: false, needsYou: false, updatedAt: '', ...more }
}
const listed = (...items: PullRequest[]): PullRequestsAnswer => ({ state: 'listed', login: 'me', items, more: false })
const known = (answer: PullRequestsAnswer | null): ProjectPulls => ({ answer, loading: false })

describe('a project\'s pull requests', () => {
  it('puts the ones that need you first and keeps GitHub\'s order inside each group', () => {
    const order = orderPulls([pull(5), pull(4, { needsYou: true }), pull(3), pull(2, { needsYou: true })]).map((each) => each.number)

    expect(order).toEqual([4, 2, 5, 3])
  })

  it('counts only the ones that need you, across every project', () => {
    const projects = [
      known(listed(pull(1, { needsYou: true }), pull(2), pull(3, { needsYou: true }))),
      known(listed(pull(4, { needsYou: true }))),
      known(listed()),
    ]

    expect(needsYouCount(projects)).toBe(3)
  })

  it('counts nothing for a project whose pull requests could not be listed', () => {
    const unlisted: Array<PullRequestsAnswer | null> = [null, { state: 'not-installed' }, { state: 'not-signed-in' }, { state: 'not-on-github' }, { state: 'failed', why: 'no network' }]

    expect(unlisted.map(needsYouIn)).toEqual([0, 0, 0, 0, 0])
    expect(needsYouCount(unlisted.map(known))).toBe(0)
  })

  it('tells the same folder on two machines apart', () => {
    expect(pullsKey({ machineName: null, folder: '/code/app' })).not.toBe(pullsKey({ machineName: 'devbox', folder: '/code/app' }))
    expect(pullsKey({ machineName: 'devbox', folder: '/code/app' })).toBe(pullsKey({ machineName: 'devbox', folder: '/code/app' }))
  })

  it('marks one that needs you as needs you, whatever else is true of it', () => {
    const waiting = [
      pull(1, { needsYou: true, reviewRequested: true, checks: 'running' }),
      pull(2, { needsYou: true, mine: true, checks: 'failed' }),
      pull(3, { needsYou: true, mine: true, review: 'changes-requested', checks: 'passed' }),
    ]

    expect(waiting.map((each) => pullStanding(each).mark)).toEqual(['needs', 'needs', 'needs'])
  })

  it('never marks one that does not need you as needs you', () => {
    const others = [
      pull(1, { checks: 'failed' }),
      pull(2, { review: 'changes-requested' }),
      pull(3, { conflicting: true }),
      pull(4, { checks: 'running' }),
      pull(5, { review: 'approved', checks: 'passed' }),
      pull(6),
    ]

    expect(others.map((each) => pullStanding(each).mark)).toEqual(['idle', 'idle', 'idle', 'working', 'done', 'idle'])
  })

  it('finds the ones that need you in the other projects, with each project\'s name', () => {
    const projects = new Map<string, ProjectPulls>([
      ['shop', known(listed(pull(1, { needsYou: true })))],
      ['api', known(listed(pull(2, { needsYou: true }), pull(3)))],
      ['notes', known({ state: 'not-on-github' })],
    ])

    const elsewhere = needsYouElsewhere(projects, 'shop', (key) => key.toUpperCase())

    expect(elsewhere.map(({ project, pull: found }) => [project, found.number])).toEqual([['API', 2]])
  })
})

describe('explainPullsFailure', () => {
  it('names the repository GitHub cannot see and offers a new sign-in, keeping gh’s words', () => {
    const why = "GraphQL: Could not resolve to a Repository with the name 'acme/shop'. (repository)"
    const said = explainPullsFailure(why, 'this computer')
    expect(said.title).toBe('GitHub can’t see this repository')
    expect(said.body).toContain('acme/shop')
    expect(said).toMatchObject({ detail: why, signIn: true })
  })

  it('tells a lost connection from a run-out sign-in, and falls back to gh’s own message', () => {
    expect(explainPullsFailure('error connecting to api.github.com', 'box').title).toBe('GitHub could not be reached')
    expect(explainPullsFailure('HTTP 401: Bad credentials', 'box')).toMatchObject({ title: 'GitHub sign-in has run out', signIn: true })
    expect(explainPullsFailure('something odd', 'box')).toMatchObject({ title: 'Could not read the pull requests', detail: 'something odd', signIn: false })
  })
})
