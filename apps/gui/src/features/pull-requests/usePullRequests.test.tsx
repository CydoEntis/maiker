import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PullRequest, PullRequestsAnswer } from '@/api/pullRequests'
import { pullRequestOpened } from '@/data/pullRequestNews'
import type { PullsProject } from './model'
import { PULLS_POLL_MS, pullsOf, usePullRequestsState } from './usePullRequests'

const api = vi.hoisted(() => ({ loadPullRequests: vi.fn<(machine: number, folder: string, fresh: boolean) => Promise<PullRequestsAnswer>>() }))
vi.mock('@/api/pullRequests', () => api)

const SHOP: PullsProject = { machineName: null, folder: '/home/me/shop' }
const API: PullsProject = { machineName: 'devbox', folder: '/srv/api' }
const DEVBOX = 4

function pull(number: number, needsYou: boolean): PullRequest {
  return { number, url: `https://github.com/o/r/pull/${String(number)}`, title: 'A change', author: 'someone', branch: 'work', draft: false, checks: 'none', review: 'none', conflicting: false, mine: false, reviewRequested: needsYou, needsYou, updatedAt: '' }
}
const listed = (...items: PullRequest[]): PullRequestsAnswer => ({ state: 'listed', login: 'me', items, more: false })

/** Puts the window in front or behind another, as the system does. */
function windowInFront(inFront: boolean) {
  vi.spyOn(document, 'hasFocus').mockReturnValue(inFront)
  act(() => { window.dispatchEvent(new Event(inFront ? 'focus' : 'blur')) })
}

const machineOf = (connected: boolean) => (name: string | null) => (name === null ? 0 : connected ? DEVBOX : null)
const show = (projects: readonly PullsProject[], connected = true) => renderHook(({ shown, up }) => usePullRequestsState({ projects: shown, machineOf: machineOf(up) }), { initialProps: { shown: projects, up: connected } })
/** Lets the answers that are out arrive. */
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  api.loadPullRequests.mockReset()
  api.loadPullRequests.mockResolvedValue(listed())
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the window\'s pull requests', () => {
  it('asks each opened project\'s own machine when the window is in front, and counts the ones that need you', async () => {
    api.loadPullRequests.mockImplementation((machine) => Promise.resolve(machine === DEVBOX ? listed(pull(1, true), pull(2, false)) : listed(pull(3, true))))

    const { result } = show([SHOP, API])
    await settle()

    expect(api.loadPullRequests.mock.calls).toEqual([[0, SHOP.folder, false], [DEVBOX, API.folder, false]])
    expect(result.current.needsYou).toBe(2)
    expect(pullsOf(result.current, API)).toEqual({ answer: listed(pull(1, true), pull(2, false)), loading: false })
  })

  it('asks again every five minutes while the window stays in front', async () => {
    show([SHOP])
    await settle()
    expect(api.loadPullRequests).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(PULLS_POLL_MS) })
    expect(api.loadPullRequests).toHaveBeenCalledTimes(2)
  })

  it('asks nothing while the window is behind another, and asks when it comes back', async () => {
    show([SHOP])
    await settle()
    windowInFront(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(PULLS_POLL_MS * 3) })
    expect(api.loadPullRequests).toHaveBeenCalledTimes(1)

    windowInFront(true)
    await settle()
    expect(api.loadPullRequests).toHaveBeenCalledTimes(2)
  })

  it('asks past the kept list when this window opens a pull request', async () => {
    show([SHOP])
    await settle()

    act(() => { pullRequestOpened() })
    await settle()

    expect(api.loadPullRequests).toHaveBeenLastCalledWith(0, SHOP.folder, true)
  })

  it('asks a project that was just opened, and stops counting one taken off the list', async () => {
    api.loadPullRequests.mockResolvedValue(listed(pull(1, true)))
    const { result, rerender } = show([SHOP])
    await settle()
    expect(result.current.needsYou).toBe(1)

    rerender({ shown: [SHOP, API], up: true })
    await settle()
    expect(api.loadPullRequests).toHaveBeenCalledWith(DEVBOX, API.folder, false)
    expect(result.current.needsYou).toBe(2)

    rerender({ shown: [API], up: true })
    expect(result.current.needsYou).toBe(1)
  })

  it('leaves a machine that is not connected alone, and asks it once it is back', async () => {
    const { rerender } = show([API], false)
    await settle()
    expect(api.loadPullRequests).not.toHaveBeenCalled()

    rerender({ shown: [API], up: true })
    await settle()
    expect(api.loadPullRequests).toHaveBeenCalledWith(DEVBOX, API.folder, false)
  })

  it('asks one project again for a surface, keeping what it said while the new answer is out', async () => {
    api.loadPullRequests.mockResolvedValueOnce(listed(pull(1, true)))
    const { result } = show([SHOP])
    await settle()
    api.loadPullRequests.mockReturnValueOnce(new Promise(() => undefined))

    act(() => { result.current.refresh(SHOP, true) })

    expect(api.loadPullRequests).toHaveBeenLastCalledWith(0, SHOP.folder, true)
    expect(pullsOf(result.current, SHOP)).toEqual({ answer: listed(pull(1, true)), loading: true })
    expect(result.current.needsYou).toBe(1)
  })
})
