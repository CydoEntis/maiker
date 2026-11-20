import { Button } from '@/components/ui/button'
import { SkeletonLines } from '@/components/ui/skeleton'
import { Tag } from '@/components/ui/tag'
import { Icon } from '@/features/workspace/components/glyphs'
import type { GitHubRepo } from '@/api/githubRepos'
import { ago } from '@/features/inspect/format'
import { copySignInCode, openSignInLink } from '@/features/signin/signInActions'
import { failureWords, linkHost } from '@/features/signin/signInWords'
import type { SignInView } from '@/features/signin/useAgentSignIn'
import type { GitHubAccountState } from './useGitHubAccount'
import { useGitHubRepos } from './useGitHubRepos'

/** Where GitHub gives out its command line. */
const GH_SITE = 'cli.github.com'
const MOST_SEARCH_CHARS = 100
const MS_PER_SECOND = 1000

type Actions = {
  signIn: () => void
  cancelSignIn: () => void
  closeSignIn: () => void
  signOut: () => void
}

type Props = Actions & {
  account: GitHubAccountState
  view: SignInView | null
  /** Stops a clone already running from being started twice. */
  disabled: boolean
  /** The folder a repository is already in on this computer, or null when it is not there. */
  folderOf: (repo: GitHubRepo) => string | null
  onClone: (repo: GitHubRepo) => void
  onOpen: (folder: string) => void
}

function updatedWords(pushedAt: string): string | null {
  const at = Date.parse(pushedAt)
  return Number.isNaN(at) ? null : `updated ${ago(at / MS_PER_SECOND, Date.now() / MS_PER_SECOND)}`
}

/** The one-time code and link `gh auth login --web` printed, and what to do with them. Never a token. */
function DeviceCode({ view, onCancel, onClose, onRetry }: { view: SignInView; onCancel: () => void; onClose: () => void; onRetry: () => void }) {
  const { state, problem } = view
  const waiting = problem === null && state.kind === 'waiting'
  const link = state.kind === 'waiting' ? state.link : null
  const code = state.kind === 'waiting' ? state.code : null
  const retryable = problem !== null || (state.kind === 'failed' && state.failure !== 'unsupported' && state.failure !== 'not-installed')
  return (
    <div className="mx-op-sign" role="region" aria-label="Sign in to GitHub">
      {problem !== null && <p role="alert">{problem}</p>}
      {problem === null && state.kind === 'failed' && <p role="alert">{failureWords('github', state.failure)}</p>}
      {waiting && link === null && code === null && <p role="status">Starting GitHub&apos;s sign-in…</p>}
      {waiting && link !== null && <p>Enter this code at <b>{linkHost(link)}</b>.</p>}
      {waiting && code !== null && <span className="mx-op-code" aria-label="One-time code">{code}</span>}
      {waiting && <p role="status" className="mx-op-wait">Waiting for GitHub…</p>}
      <div className="mx-op-actions">
        {waiting && link !== null && <Button variant="primary" size="sm" onClick={() => { openSignInLink(link) }}>Open link</Button>}
        {waiting && code !== null && <Button variant="soft" size="sm" onClick={() => { copySignInCode(code) }}>Copy code</Button>}
        {waiting && <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}
        {retryable && <Button variant="soft" size="sm" onClick={onRetry}>Try again</Button>}
        {!waiting && <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>}
      </div>
    </div>
  )
}

function Repos({ disabled, folderOf, onClone, onOpen }: Pick<Props, 'disabled' | 'folderOf' | 'onClone' | 'onOpen'>) {
  const { typed, setTyped, owners, owner, setOwner, result, rows } = useGitHubRepos()
  const list = result?.state === 'listed' ? result.listed : null
  return (
    <>
      <div className="mx-op-search">
        <label className="mx-op-find">
          <Icon name="search" size={13} />
          <input aria-label="Search your repositories" placeholder="Search your repositories" value={typed} maxLength={MOST_SEARCH_CHARS} spellCheck={false} disabled={disabled} onChange={(event) => { setTyped(event.target.value) }} />
        </label>
        {owners.length > 1 && (
          <select aria-label="Owner" value={owner ?? owners[0]} disabled={disabled} onChange={(event) => { setOwner(event.target.value) }}>
            {owners.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
      </div>
      <ul className="mx-op-list" aria-label="Your repositories on GitHub">
        {result === null && <li><SkeletonLines label="Reading your repositories" lines={4} /></li>}
        {result?.state === 'failed' && <li role="alert">{result.why}. You can still clone from a URL.</li>}
        {rows.map((repo) => {
          const folder = folderOf(repo)
          const meta = repo.description === '' ? updatedWords(repo.pushedAt) : repo.description
          return (
            <li key={repo.name} className="mx-op-row">
              <span className="mx-op-row-text">
                <span className="mx-op-row-name" title={repo.name}>{repo.name}{repo.private && <Tag>Private</Tag>}</span>
                {meta !== null && <span className="mx-op-row-meta">{meta}</span>}
              </span>
              {folder === null
                ? <Button variant="soft" size="sm" disabled={disabled} aria-label={`Clone ${repo.name}`} onClick={() => { onClone(repo) }}>Clone</Button>
                : <Button variant="soft" size="sm" disabled={disabled} aria-label={`Open ${repo.name}`} onClick={() => { onOpen(folder) }}>Open</Button>}
            </li>
          )
        })}
        {list !== null && rows.length === 0 && <li role="status">{typed.trim() === '' ? 'No repositories here yet.' : 'No repository matches.'}</li>}
      </ul>
      {list?.more === true && <p role="status" className="mx-op-note">Showing the first {rows.length} repositories. Search to find the others.</p>}
    </>
  )
}

/** The GitHub tab: sign in with GitHub's device flow, then search the account's repositories and clone or open one. */
export function GitHubPanel({ account, view, signIn, cancelSignIn, closeSignIn, signOut, ...repos }: Props) {
  const flowing = view !== null && (view.problem !== null || view.state.kind === 'waiting' || view.state.kind === 'failed')
  if (flowing) return <div className="mx-op-panel"><DeviceCode view={view} onCancel={cancelSignIn} onClose={closeSignIn} onRetry={signIn} /></div>
  switch (account.kind) {
    case 'loading':
      return <div className="mx-op-panel"><SkeletonLines label="Looking for your GitHub account" lines={3} /></div>
    case 'no-gh':
      return (
        <div className="mx-op-panel">
          <p role="status">GitHub&apos;s command line (gh) is not installed on this computer, so Maiker cannot sign you in or list your repositories. Get it from {GH_SITE}, then open this window again. Cloning from a URL still works.</p>
        </div>
      )
    case 'unknown':
      return <div className="mx-op-panel"><p role="alert">{account.why}. You can still clone from a URL.</p></div>
    case 'signed-out':
      return (
        <div className="mx-op-panel mx-op-sign">
          <p>Sign in once to see your repositories and clone private ones. Maiker uses GitHub&apos;s device sign-in; it never sees your password.</p>
          <div className="mx-op-actions"><Button variant="primary" size="sm" onClick={signIn}>Sign in with GitHub</Button></div>
        </div>
      )
    case 'signed-in':
      return (
        <div className="mx-op-panel">
          <div className="mx-op-account">
            <span className="mx-op-who"><span className="mx-op-avatar" aria-hidden="true">{account.login.slice(0, 1).toUpperCase()}</span>Signed in as <strong>{account.login}</strong></span>
            <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
          </div>
          <Repos {...repos} />
        </div>
      )
  }
}
