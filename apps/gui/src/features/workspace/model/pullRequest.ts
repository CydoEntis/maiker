/** The pull request of a session's branch, as the daemon polls it (`PrInfo` in the protocol). */
export type PullRequest = {
  number: number
  url: string
  title: string
  state: 'Open' | 'Merged' | 'Closed'
  draft: boolean
  checks: { passed: number; pending: number; failed: string[] }
  review: 'None' | 'Required' | 'Approved' | 'ChangesRequested'
  conflicting: boolean
  /** Commits on the branch after the merged pull request: work going on after its merge. */
  commitsAfterMerge: number
}
