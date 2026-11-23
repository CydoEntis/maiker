import type { ReactNode } from 'react'
import { AlertTriangle, GitPullRequest } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PullRequest } from '@/api/pullRequests'
import { StatusIcon } from '@/components/ui/status-icon'
import { explainPullsFailure, orderPulls, pullAuthor, pullStanding, type ProjectPulls, type PullElsewhere } from './model'
import './pull-requests.css'

/** Where GitHub gives out its command line. */
const GH_SITE = 'cli.github.com'

type Props = {
  /** What the project's machine last said, and whether it is being asked again. */
  pulls: ProjectPulls
  /** The project's machine as a sentence names it: "this computer", or the machine's name. */
  where: string
  /** Pull requests that need the person in the other opened projects. */
  elsewhere: readonly PullElsewhere[]
  /** Opens a pull request in the browser. */
  onOpen: (url: string) => void
  /** Asks the machine again after a failure. */
  onRetry: () => void
  /** Starts GitHub's own sign-in on the project's machine; absent where it cannot be started. */
  onSignIn?: (() => void) | undefined
}

/** One pull request: its mark, title, number, branch and author, and where it stands. A click opens it on GitHub. */
function PullRow({ pull, project, onOpen }: { pull: PullRequest; project?: string; onOpen: (url: string) => void }) {
  const standing = pullStanding(pull)
  const title = pull.title === '' ? `Pull request ${String(pull.number)}` : pull.title
  const where = [project, pull.branch, pullAuthor(pull)].filter((part) => part !== undefined && part !== '').join(' · ')
  return (
    <li>
      <button type="button" className="mx-pr-row" data-needs={pull.needsYou ? true : undefined} title="Open on GitHub" onClick={() => { onOpen(pull.url) }}>
        <span className="mx-pr-mark"><StatusIcon status={standing.mark} /></span>
        <span className="mx-pr-text">
          <span className="mx-pr-title">{title}</span>
          <span className="mx-pr-detail"><b>#{pull.number}</b> {where}</span>
        </span>
        <span className="mx-pr-standing">{standing.text}{pull.needsYou && <span className="mx-pr-you"> · needs you</span>}</span>
      </button>
    </li>
  )
}

/**
 * A state with nothing to list: a mark, a title, one plain paragraph, the raw detail when there is one, and the things to
 * do about it. A failure takes the warning mark and tone; anything else the pull-request mark.
 */
function Note({ title, children, action, detail, failed = false }: { title: string; children?: ReactNode; action?: ReactNode; detail?: string; failed?: boolean }) {
  return (
    <div className="mx-pr-state" role="status" data-failed={failed ? true : undefined}>
      <span className="mx-pr-state-mark" aria-hidden="true">{failed ? <AlertTriangle /> : <GitPullRequest />}</span>
      <strong className="mx-pr-state-title">{title}</strong>
      {children !== undefined && <p className="mx-pr-state-body">{children}</p>}
      {detail !== undefined && detail !== '' && <pre className="mx-pr-state-detail">{detail}</pre>}
      {action !== undefined && <div className="mx-pr-state-actions">{action}</div>}
    </div>
  )
}

function ProjectList({ pulls, where, onOpen, onRetry, onSignIn }: Pick<Props, 'pulls' | 'where' | 'onOpen' | 'onRetry' | 'onSignIn'>) {
  const { answer, loading } = pulls
  if (answer === null) return <Note title="Reading pull requests…" />
  switch (answer.state) {
    case 'not-installed':
      return <Note title="GitHub’s command line is not installed">Maiker reads pull requests with gh on {where}. Get it from {GH_SITE}, then sign in.</Note>
    case 'not-signed-in':
      return (
        <Note title="Not signed in to GitHub" action={onSignIn && <Button type="button" variant="primary" size="lg" onClick={onSignIn}>Sign in to GitHub</Button>}>
          Nobody is signed in to GitHub on {where}, so its pull requests can’t be read.
        </Note>
      )
    case 'not-on-github':
      return <Note title="This project is not on GitHub">Pull requests show here for a project with a GitHub remote.</Note>
    case 'failed': {
      const failure = explainPullsFailure(answer.why, where)
      return (
        <Note
          failed
          title={failure.title}
          detail={failure.detail}
          action={(
            <>
              {failure.signIn && onSignIn && <Button type="button" variant="ghost" size="lg" onClick={onSignIn}>Sign in to GitHub</Button>}
              <Button type="button" variant="primary" size="lg" disabled={loading} onClick={onRetry}>{loading ? 'Trying…' : 'Try again'}</Button>
            </>
          )}
        >
          {failure.body}
        </Note>
      )
    }
    case 'listed':
      if (answer.items.length === 0) return <Note title="No open pull requests" />
      return (
        <>
          <ul className="mx-pr-list" aria-label="Pull requests">
            {orderPulls(answer.items).map((pull) => <PullRow key={pull.number} pull={pull} onOpen={onOpen} />)}
          </ul>
          {answer.more && <p className="mx-inspect-note">Showing the first {answer.items.length}. The rest are on GitHub.</p>}
          {/* Whose "needs you" this is: the machine's signed-in account, which a folder's own rule may differ from. */}
          {answer.login !== '' && <p className="mx-inspect-note">Signed in as {answer.login} on {where}</p>}
        </>
      )
  }
}

/**
 * The side panel's Pull requests surface: the open pull requests of the session's project, the ones that need the person
 * first, then those that need them in the other opened projects, so the count on the sidebar's button is always here.
 */
export function PullRequestsSurface({ pulls, where, elsewhere, onOpen, onRetry, onSignIn }: Props) {
  return (
    <div className="mx-pr" aria-busy={pulls.loading}>
      <ProjectList pulls={pulls} where={where} onOpen={onOpen} onRetry={onRetry} onSignIn={onSignIn} />
      {elsewhere.length > 0 && (
        <section className="mx-pr-elsewhere" aria-label="Needs you in other projects">
          <h3 className="mx-pr-heading">Needs you in other projects</h3>
          <ul className="mx-pr-list" aria-label="Pull requests in other projects">
            {elsewhere.map(({ project, pull }) => <PullRow key={pull.url} pull={pull} project={project} onOpen={onOpen} />)}
          </ul>
        </section>
      )}
    </div>
  )
}
