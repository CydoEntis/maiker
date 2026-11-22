import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import { errorMessage } from '@/lib/error-message'
import { LOCAL_MACHINE } from './machines'

const CHECKS = { None: 'none', Running: 'running', Failed: 'failed', Passed: 'passed' } as const
const REVIEW = { None: 'none', Required: 'required', Approved: 'approved', ChangesRequested: 'changes-requested' } as const

const PullSchema = z.object({
  number: z.number().int(),
  url: z.string(),
  title: z.string(),
  author: z.string(),
  branch: z.string(),
  draft: z.boolean(),
  checks: z.enum(['None', 'Running', 'Failed', 'Passed']),
  review: z.enum(['None', 'Required', 'Approved', 'ChangesRequested']),
  conflicting: z.boolean(),
  mine: z.boolean(),
  review_requested: z.boolean(),
  needs_you: z.boolean(),
  updated_at: z.string(),
})
const AnswerSchema = z.object({
  state: z.enum(['listed', 'not-installed', 'not-signed-in', 'not-on-github', 'failed']),
  why: z.string().nullable(),
  listed: z.object({ login: z.string(), items: z.array(PullSchema), more: z.boolean() }).nullable(),
})

/** One open pull request of a project, as the project's machine reads it from GitHub. */
export type PullRequest = {
  number: number
  /** Its github.com address: what a click opens. */
  url: string
  title: string
  /** Who opened it; empty when unknown. */
  author: string
  branch: string
  draft: boolean
  checks: (typeof CHECKS)[keyof typeof CHECKS]
  review: (typeof REVIEW)[keyof typeof REVIEW]
  conflicting: boolean
  /** The account signed in on that machine opened it. */
  mine: boolean
  /** A review is asked of that account. */
  reviewRequested: boolean
  /** That account has something to do on it. The machine's daemon decides this; the window shows and counts it. */
  needsYou: boolean
  /** When it last changed, as GitHub writes a time; empty when unknown. */
  updatedAt: string
}

/**
 * What a project's machine said of its open pull requests. Having no GitHub command line there, nobody signed in, and a
 * project GitHub does not host are answers with their own words, not errors.
 */
export type PullRequestsAnswer =
  | { state: 'listed'; /** The account signed in there. */ login: string; items: PullRequest[]; /** There are more than were given. */ more: boolean }
  | { state: 'not-installed' }
  | { state: 'not-signed-in' }
  | { state: 'not-on-github' }
  | { state: 'failed'; why: string }

const NO_ANSWER = 'The pull requests could not be read'

/**
 * The open pull requests of the repository `folder` is in, on `machine` (this computer is machine 0). The machine keeps
 * a project's list for a minute; `fresh` asks past it, for when the list is known to have changed. Never rejects: a
 * machine that cannot be asked, or a service too old to know the question, is a `failed` answer saying so.
 */
export async function loadPullRequests(machine: number, folder: string, fresh: boolean): Promise<PullRequestsAnswer> {
  try {
    const answer = AnswerSchema.parse(await invoke<unknown>('pull_requests', machine === LOCAL_MACHINE ? { folder, fresh } : { machine, folder, fresh }))
    if (answer.state === 'failed') return { state: 'failed', why: answer.why ?? NO_ANSWER }
    if (answer.state !== 'listed') return { state: answer.state }
    if (answer.listed === null) return { state: 'failed', why: NO_ANSWER }
    return {
      state: 'listed',
      login: answer.listed.login,
      more: answer.listed.more,
      items: answer.listed.items.map((pull) => ({
        number: pull.number,
        url: pull.url,
        title: pull.title,
        author: pull.author,
        branch: pull.branch,
        draft: pull.draft,
        checks: CHECKS[pull.checks],
        review: REVIEW[pull.review],
        conflicting: pull.conflicting,
        mine: pull.mine,
        reviewRequested: pull.review_requested,
        needsYou: pull.needs_you,
        updatedAt: pull.updated_at,
      })),
    }
  } catch (error) {
    return { state: 'failed', why: errorMessage(error, NO_ANSWER) }
  }
}
