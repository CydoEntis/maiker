import { useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowDownUp, CircleAlert, CircleCheck, CircleX, Clock, GitPullRequest } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import type { PullRequest } from '@/api/pullRequests'
import { StatusIcon } from '@/components/ui/status-icon'
import { explainPullsFailure, PULLS_SHOW, PULLS_SORT, pullAuthor, pullStanding, shownPulls, type ProjectPulls, type PullElsewhere, type PullsShow, type PullsSort, type PullTone } from './model'
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

/** The mark before where a pull request stands, in its tone's colour. */
function ToneMark({ tone }: { tone: PullTone }) {
  switch (tone) {
    case 'needs': return <CircleAlert aria-hidden="true" />
    case 'failed': return <CircleX aria-hidden="true" />
    case 'running': return <StatusIcon status="working" size={14} />
    case 'passed': return <CircleCheck aria-hidden="true" />
    case 'waiting': return <Clock aria-hidden="true" />
    case 'open': return <CircleAlert aria-hidden="true" />
  }
}

/**
 * One pull request: its title, then its number, branch and author, then where it stands behind a mark in that standing's
 * colour (a check by Checks passed, a cross by Checks failed, a blue mark by Open). A click opens it on GitHub.
 */
function PullRow({ pull, project, onOpen }: { pull: PullRequest; project?: string; onOpen: (url: string) => void }) {
  const standing = pullStanding(pull)
  const title = pull.title === '' ? `Pull request ${String(pull.number)}` : pull.title
  const where = [project, pull.branch, pullAuthor(pull)].filter((part) => part !== undefined && part !== '').join(' · ')
  return (
    <li>
      <button type="button" className="mx-pr-row" data-needs={pull.needsYou ? true : undefined} title="Open on GitHub" onClick={() => { onOpen(pull.url) }}>
        <span className="mx-pr-title">{title}</span>
        <span className="mx-pr-detail"><b>#{pull.number}</b> {where}</span>
        <span className={`mx-pr-standing is-${standing.tone}`}><ToneMark tone={standing.tone} />{standing.text}{pull.needsYou && standing.tone === 'needs' && <span className="mx-pr-you"> · needs you</span>}</span>
      </button>
    </li>
  )
}

/** Search, which pull requests to show and their order, over the list; the count says how many of how many show. */
function PullsTools({ query, onQuery, show, onShow, sort, onSort, shown, total }: { query: string; onQuery: (query: string) => void; show: PullsShow; onShow: (show: PullsShow) => void; sort: PullsSort; onSort: (sort: PullsSort) => void; shown: number; total: number }) {
  const sortLabel = PULLS_SORT.find((option) => option.key === sort)?.label ?? ''
  return (
    <div className="mx-pr-tools">
      <label className="mx-search-field mx-pr-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input value={query} placeholder="Search by title, branch, author or #" aria-label="Search pull requests" onChange={(event) => { onQuery(event.target.value) }} onKeyDown={(event) => { if (event.key === 'Escape' && query !== '') { event.stopPropagation(); onQuery('') } }} />
      </label>
      <div className="mx-pr-tools-row">
        <Segmented aria-label="Show" value={show} onValueChange={(value) => { onShow(value as PullsShow) }}>
          {PULLS_SHOW.map((option) => <SegmentedItem key={option.key} value={option.key}>{option.label}</SegmentedItem>)}
        </Segmented>
        <span className="mx-pr-count" role="status">{shown === total ? `${String(total)} open` : `${String(shown)} of ${String(total)}`}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="mx-pr-sort" aria-label={`Sort: ${sortLabel}`}><ArrowDownUp aria-hidden="true" />{sortLabel}</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" container={document.querySelector<HTMLElement>('.mx-app')} aria-label="Sort pull requests">
            <DropdownMenuRadioGroup value={sort} onValueChange={(value) => { onSort(value as PullsSort) }}>
              {PULLS_SORT.map((option) => <DropdownMenuRadioItem key={option.key} value={option.key}>{option.label}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
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
  const [query, setQuery] = useState('')
  const [show, setShow] = useState<PullsShow>('all')
  const [sort, setSort] = useState<PullsSort>('needs-you')
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
      return <Listed items={answer.items} more={answer.more} onOpen={onOpen} tools={{ query, setQuery, show, setShow, sort, setSort }} />
  }
}

type Tools = { query: string; setQuery: (query: string) => void; show: PullsShow; setShow: (show: PullsShow) => void; sort: PullsSort; setSort: (sort: PullsSort) => void }

/** A project's open pull requests under the search, filter and sort, or a line saying none match. */
function Listed({ items, more, onOpen, tools }: { items: readonly PullRequest[]; more: boolean; onOpen: (url: string) => void; tools: Tools }) {
  const { query, setQuery, show, setShow, sort, setSort } = tools
  const shown = shownPulls(items, { query, show, sort })
  return (
    <>
      <PullsTools query={query} onQuery={setQuery} show={show} onShow={setShow} sort={sort} onSort={setSort} shown={shown.length} total={items.length} />
      {shown.length === 0
        ? <p className="mx-pr-none" role="status">No pull requests match. <button type="button" className="mx-pr-clear" onClick={() => { setQuery(''); setShow('all') }}>Show all</button></p>
        : (
          <ul className="mx-pr-list" aria-label="Pull requests">
            {shown.map((pull) => <PullRow key={pull.number} pull={pull} onOpen={onOpen} />)}
          </ul>
        )}
      {more && <p className="mx-inspect-note">Showing the first {items.length}. The rest are on GitHub.</p>}
    </>
  )
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
