import { useEffect, useMemo, useState } from 'react'
import { loadGitHubOwners, loadGitHubRepos, type GitHubList, type GitHubRepo, type GitHubRepoList } from '@/api/githubRepos'
import { LOCAL_MACHINE } from '@/api/machines'
import { errorMessage } from '@/lib/error-message'

/** How long after the last keystroke GitHub is asked again. */
const SEARCH_DELAY_MS = 300

type Asked = { owner: string | null; search: string }
type Answered = { asked: Asked; result: GitHubList<GitHubRepoList> }

export type GitHubRepos = {
  owners: readonly string[]
  owner: string | null
  setOwner: (name: string) => void
  /** Null while the answer for what is asked is still on its way. */
  result: GitHubList<GitHubRepoList> | null
  /** The repositories, newest push first. */
  rows: readonly GitHubRepo[]
}

/** Newest pushed first; a repository with no known time goes last. GitHub's times sort as text. */
function newestFirst(repos: readonly GitHubRepo[]): GitHubRepo[] {
  return [...repos].sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))
}

/**
 * The repositories this computer's GitHub account can clone, narrowed by the search `typed` in the palette and by an owner
 * when the account belongs to organisations. Nothing is asked until somebody is `signedIn`. Every name came from `gh`
 * through the daemon. An answer for a search the person has since changed is never shown.
 */
export function useGitHubRepos(typed: string, signedIn: boolean): GitHubRepos {
  const [owners, setOwners] = useState<readonly string[]>([])
  const [owner, setOwner] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [answered, setAnswered] = useState<Answered | null>(null)
  const asked = useMemo<Asked>(() => ({ owner, search }), [owner, search])

  useEffect(() => {
    if (!signedIn) return undefined
    let live = true
    loadGitHubOwners(LOCAL_MACHINE).then(
      (answer) => { if (live && answer.state === 'listed') setOwners(answer.listed) },
      // Without the owners there is no owner menu; the repositories' own answer says what is wrong.
      () => undefined,
    )
    return () => { live = false }
  }, [signedIn])

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(typed.trim()) }, SEARCH_DELAY_MS)
    return () => { window.clearTimeout(timer) }
  }, [typed])

  useEffect(() => {
    if (!signedIn) return undefined
    let live = true
    loadGitHubRepos(LOCAL_MACHINE, asked.owner, asked.search).then(
      (result) => { if (live) setAnswered({ asked, result }) },
      (error: unknown) => { if (live) setAnswered({ asked, result: { state: 'failed', why: errorMessage(error, 'The repositories could not be listed') } }) },
    )
    return () => { live = false }
  }, [asked, signedIn])

  const result = answered !== null && answered.asked.owner === asked.owner && answered.asked.search === asked.search ? answered.result : null
  const rows = useMemo(() => (result?.state === 'listed' ? newestFirst(result.listed.repos) : []), [result])
  return { owners, owner, setOwner, result, rows }
}
