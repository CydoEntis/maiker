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

/** Where a pull request stands in a few words, and the mark that goes with it. */
export type PullStanding = { text: string; mark: StatusMarkKind }

/**
 * What a row says of a pull request. One that needs the person says why first; after that the thing that holds it up,
 * then how far it has got.
 */
export function pullStanding(pull: PullRequest): PullStanding {
  if (pull.needsYou) {
    if (pull.reviewRequested) return { text: 'Review requested', mark: 'needs' }
    if (pull.checks === 'failed') return { text: 'Checks failed', mark: 'needs' }
    return { text: 'Changes requested', mark: 'needs' }
  }
  if (pull.conflicting) return { text: 'Has conflicts', mark: 'idle' }
  if (pull.checks === 'failed') return { text: 'Checks failed', mark: 'idle' }
  if (pull.checks === 'running') return { text: 'Checks running', mark: 'working' }
  if (pull.review === 'changes-requested') return { text: 'Changes requested', mark: 'idle' }
  if (pull.review === 'approved') return { text: pull.draft ? 'Approved' : 'Ready to merge', mark: 'done' }
  if (pull.review === 'required') return { text: 'Waiting for review', mark: 'idle' }
  if (pull.checks === 'passed') return { text: 'Checks passed', mark: 'done' }
  return { text: 'Open', mark: 'idle' }
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
