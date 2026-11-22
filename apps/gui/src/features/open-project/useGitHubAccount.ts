import { useCallback, useEffect, useState } from 'react'
import { agentSignIn } from '@/api/agentSignIn'
import { loadGitHubAccounts } from '@/api/githubAccounts'
import { LOCAL_MACHINE } from '@/api/machines'
import { errorMessage } from '@/lib/error-message'
import { toast } from '@/lib/toast'
import { useAgentSignIn, type SignInView } from '@/features/signin/useAgentSignIn'

/** Who is signed in to GitHub on this computer, as its `gh` says. Never a token. */
export type GitHubAccountState =
  | { kind: 'loading' }
  | { kind: 'no-gh' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; login: string }
  | { kind: 'unknown'; why: string }

const LOADING: GitHubAccountState = { kind: 'loading' }

/**
 * The GitHub account for the palette's GitHub level: `signIn` runs `gh auth login --web` through the daemon and the
 * level shows `view`, the code and link it printed. `gh` keeps the token; the window only learns the login name.
 */
export function useGitHubAccount(): { account: GitHubAccountState; view: SignInView | null; signIn: () => void; cancelSignIn: () => void; closeSignIn: () => void; signOut: () => void } {
  const [account, setAccount] = useState<GitHubAccountState>(LOADING)
  const [asked, setAsked] = useState(0)
  const again = useCallback(() => { setAsked((count) => count + 1) }, [])
  const flow = useAgentSignIn(again)

  useEffect(() => {
    let current = true
    loadGitHubAccounts(LOCAL_MACHINE).then(
      (report) => {
        if (!current) return
        const active = report.accounts.find((one) => one.active) ?? report.accounts[0]
        if (!report.installed) setAccount({ kind: 'no-gh' })
        else if (active !== undefined) setAccount({ kind: 'signed-in', login: active.login })
        else if (report.problem !== null) setAccount({ kind: 'unknown', why: report.problem })
        else setAccount({ kind: 'signed-out' })
      },
      (error: unknown) => { if (current) setAccount({ kind: 'unknown', why: errorMessage(error, 'The service did not answer') }) },
    )
    return () => { current = false }
  }, [asked])

  const { begin, cancel } = flow
  const signIn = useCallback(() => { begin('github') }, [begin])
  const cancelSignIn = useCallback(() => { cancel('github') }, [cancel])
  const signOut = useCallback(() => {
    agentSignIn('github', 'sign-out').then(
      () => { again() },
      (error: unknown) => { toast.failed('Could not sign out of GitHub', error) },
    )
  }, [again])
  return { account, view: flow.view, signIn, cancelSignIn, closeSignIn: flow.close, signOut }
}
