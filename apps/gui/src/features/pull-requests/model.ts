import type { PullRequest, PullRequestsAnswer } from '@/api/pullRequests'
import type { StatusMarkKind } from '@/lib/statusMark'

/** A project as the pull requests are kept for it: its machine and its folder there. */
export type PullsProject = { readonly machineName: string | null; readonly folder: string }

/** What is known of one project's pull requests: the last answer, and whether it is being asked again. */
export type ProjectPulls = { readonly answer: PullRequestsAnswer | null; readonly loading: boolean }

/** How a project is told from every other: the same folder name on two machines is two projects. */
export function pullsKey(project: PullsProject): string {
  return `${project.machineName ?? ''}\n${project.folder}`
}

/** `pulls` with the ones that need the person first; each group keeps the order GitHub gave (the newest first). */
export function orderPulls(pulls: readonly PullRequest[]): PullRequest[] {
  return [...pulls.filter((pull) => pull.needsYou), ...pulls.filter((pull) => !pull.needsYou)]
}

/** How many pull requests in `answer` need the person. An answer that is not a list counts none: never a guess. */
export function needsYouIn(answer: PullRequestsAnswer | null | undefined): number {
  return answer?.state === 'listed' ? answer.items.filter((pull) => pull.needsYou).length : 0
}

/** How many pull requests need the person across every project's answer. */
export function needsYouCount(projects: Iterable<ProjectPulls>): number {
  let count = 0
  for (const project of projects) count += needsYouIn(project.answer)
  return count
}

/**
 * How a row draws where a pull request stands: needs you (amber), held up (a failed check or a conflict, red), checks
 * running (the working mark), through (green), waiting on someone else (grey), or simply open (blue).
 */
export type PullTone = 'needs' | 'failed' | 'running' | 'passed' | 'waiting' | 'open'

/** Where a pull request stands in a few words, the status mark that goes with it, and the tone its line is drawn in. */
export type PullStanding = { text: string; mark: StatusMarkKind; tone: PullTone }

/**
 * What a row says of a pull request. One that needs the person says why first; after that the thing that holds it up,
 * then how far it has got.
 */
export function pullStanding(pull: PullRequest): PullStanding {
  if (pull.needsYou) {
    if (pull.reviewRequested) return { text: 'Review requested', mark: 'needs', tone: 'needs' }
    if (pull.checks === 'failed') return { text: 'Checks failed', mark: 'needs', tone: 'needs' }
    return { text: 'Changes requested', mark: 'needs', tone: 'needs' }
  }
  if (pull.conflicting) return { text: 'Has conflicts', mark: 'idle', tone: 'failed' }
  if (pull.checks === 'failed') return { text: 'Checks failed', mark: 'idle', tone: 'failed' }
  if (pull.checks === 'running') return { text: 'Checks running', mark: 'working', tone: 'running' }
  if (pull.review === 'changes-requested') return { text: 'Changes requested', mark: 'idle', tone: 'waiting' }
  if (pull.review === 'approved') return { text: pull.draft ? 'Approved' : 'Ready to merge', mark: 'done', tone: 'passed' }
  if (pull.review === 'required') return { text: 'Waiting for review', mark: 'idle', tone: 'waiting' }
  if (pull.checks === 'passed') return { text: 'Checks passed', mark: 'done', tone: 'passed' }
  return { text: 'Open', mark: 'idle', tone: 'open' }
}

/** Which pull requests the list shows: every one, the ones that need you, yours, the ones held up, or drafts. */
export type PullsShow = 'all' | 'needs-you' | 'mine' | 'failing' | 'drafts'
/** The list's order: the ones that need you first (then GitHub's), the most recently changed, or by number. */
export type PullsSort = 'needs-you' | 'updated' | 'newest' | 'oldest'

export const PULLS_SHOW: readonly { key: PullsShow; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'needs-you', label: 'Needs you' },
  { key: 'mine', label: 'Mine' },
  { key: 'failing', label: 'Failing' },
  { key: 'drafts', label: 'Drafts' },
]
export const PULLS_SORT: readonly { key: PullsSort; label: string }[] = [
  { key: 'needs-you', label: 'Needs you first' },
  { key: 'updated', label: 'Recently updated' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
]

const SHOWS: Readonly<Record<PullsShow, (pull: PullRequest) => boolean>> = {
  'all': () => true,
  'needs-you': (pull) => pull.needsYou,
  'mine': (pull) => pull.mine,
  'failing': (pull) => pull.checks === 'failed' || pull.conflicting,
  'drafts': (pull) => pull.draft,
}

/** Whether a pull request's number, title, branch or author holds every word of `query`, any case. */
function matchesQuery(pull: PullRequest, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter((word) => word !== '')
  const text = `#${String(pull.number)} ${pull.title} ${pull.branch} ${pull.author} ${pull.mine ? 'you' : ''}`.toLowerCase()
  return words.every((word) => text.includes(word))
}

/** `pulls` as the list shows them: the ones that match the search and the filter, in the picked order. */
export function shownPulls(pulls: readonly PullRequest[], { query, show, sort }: { query: string; show: PullsShow; sort: PullsSort }): PullRequest[] {
  const kept = pulls.filter((pull) => SHOWS[show](pull) && matchesQuery(pull, query))
  switch (sort) {
    case 'needs-you': return orderPulls(kept)
    case 'updated': return [...kept].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    case 'newest': return [...kept].sort((a, b) => b.number - a.number)
    case 'oldest': return [...kept].sort((a, b) => a.number - b.number)
  }
}

/** Who opened a pull request, as its row says it. */
export function pullAuthor(pull: PullRequest): string {
  const who = pull.mine ? 'You' : pull.author
  return [who, pull.draft ? 'draft' : ''].filter((part) => part !== '').join(' · ')
}

/** A pull request that needs the person in a project other than the one shown, with that project's name. */
export type PullElsewhere = { project: string; pull: PullRequest }

/**
 * The pull requests that need the person in every project but `shown`, so the count on the sidebar's button can always
 * be found from the surface it opens. `nameOf` gives a project's name as the sidebar says it.
 */
export function needsYouElsewhere(projects: ReadonlyMap<string, ProjectPulls>, shown: string | null, nameOf: (key: string) => string): PullElsewhere[] {
  return [...projects].flatMap(([key, project]) => {
    if (key === shown || project.answer?.state !== 'listed') return []
    return project.answer.items.filter((pull) => pull.needsYou).map((pull) => ({ project: nameOf(key), pull }))
  })
}

/** A failure in words a person can act on: what is wrong, what to do, and gh's own message kept as the detail. */
export type PullsFailure = { title: string; body: string; detail: string; signIn: boolean }

const REPO_NOT_FOUND = /Could not resolve to a Repository with the name '([^']+)'/i
const SIGNED_OUT = /bad credentials|authentication|HTTP 401|gh auth login/i
const RATE_LIMITED = /rate limit/i
const OFFLINE = /error connecting|could not resolve host|timed? ?out|network/i

/**
 * What a failed read of the pull requests means, from gh's own words (`why`) on the machine `where` names. gh answers
 * a private repository the signed-in account cannot see exactly as one that does not exist, so that case names both.
 */
export function explainPullsFailure(why: string, where: string): PullsFailure {
  const detail = why.trim()
  const missing = REPO_NOT_FOUND.exec(detail)
  if (missing !== null) {
    return {
      title: 'GitHub can’t see this repository',
      body: `The GitHub account signed in on ${where} has no access to ${missing[1] ?? 'it'}, or the repository was renamed or moved. Sign in with an account that can see it, or check the project’s remote address.`,
      detail,
      signIn: true,
    }
  }
  if (SIGNED_OUT.test(detail)) return { title: 'GitHub sign-in has run out', body: `Sign in to GitHub again on ${where} to read this project’s pull requests.`, detail, signIn: true }
  if (RATE_LIMITED.test(detail)) return { title: 'GitHub is limiting requests', body: 'Too many requests were made to GitHub in a short time. Try again in a few minutes.', detail, signIn: false }
  if (OFFLINE.test(detail)) return { title: 'GitHub could not be reached', body: `${where === 'this computer' ? 'This computer' : where} could not reach GitHub. Check the connection, then try again.`, detail, signIn: false }
  return { title: 'Could not read the pull requests', body: 'GitHub answered with an error. Its message is below.', detail, signIn: false }
}
