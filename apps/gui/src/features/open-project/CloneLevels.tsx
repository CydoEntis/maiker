import { useState } from 'react'
import { Icon } from '@/features/workspace/components/glyphs'
import { ago } from '@/features/inspect/format'
import { copySignInCode, openSignInLink } from '@/features/signin/signInActions'
import { failureWords, linkHost } from '@/features/signin/signInWords'
import { baseName, joinPath } from '@/features/workspace/model/folderPick'
import { PaletteBody, type Status } from './PaletteBody'
import { MIN_URL_CHARS_TO_JUDGE, cloneRow, nextOf, type Row, type RowAction } from './openPalette'
import { usePaletteShell, type PaletteShell } from './paletteShell'
import { readGitUrl } from './repoUrl'
import { PHASE_WORDS } from './useCloneProject'
import { useGitHubAccount } from './useGitHubAccount'
import { useGitHubRepos } from './useGitHubRepos'

/** Where GitHub gives out its command line. */
const GH_SITE = 'cli.github.com'
const MS_PER_SECOND = 1000

const plainRow = (fields: Pick<Row, 'id' | 'title' | 'action'> & Partial<Row>): Row => ({ group: null, detail: null, icon: 'github', tag: null, quiet: false, into: null, ...fields })

/** The button that says which machine a clone goes onto; a press moves to the next machine that is up. */
function OntoButton({ shell }: { shell: PaletteShell }) {
  const several = shell.machines.filter((machine) => machine.ready).length > 1
  return (
    <button type="button" className="mx-op-choice" aria-label={`Clone onto ${shell.onto.label}${several ? '. Press to change the machine' : ''}`} title="Clone onto another machine" disabled={!several || shell.locked} onClick={shell.nextOnto}>
      onto <b>{shell.onto.label}</b>
      {several && <Icon name="chevronDown" size={13} />}
    </button>
  )
}

/** What the clone says while it runs or after it was refused, and the rows that go with a refusal; null when there is no clone. */
function cloneView(shell: PaletteShell): { status: Status; rows: Row[] } | null {
  const { clone } = shell
  if (clone.kind === 'idle') return null
  if (clone.kind === 'cloning') {
    const where = `into ${clone.target} on ${shell.machineOf(clone.machine).label}`
    return {
      status: { tone: 'working', title: `Cloning ${clone.label}`, detail: clone.progress === null ? where : `${PHASE_WORDS[clone.progress.phase]} · ${where}`, percent: clone.progress?.percent ?? null },
      rows: [],
    }
  }
  const { problem, machine } = clone
  const there = problem.kind === 'exists' && problem.folder !== undefined && problem.folder !== '' ? problem.folder : null
  return {
    status: { tone: 'bad', title: 'Could not clone the repository', detail: problem.message },
    rows: there === null ? [] : [plainRow({ id: `existing:${there}`, title: `${shell.mode === 'open' ? 'Open' : 'Choose'} ${baseName(there)}`, detail: `It is already at ${there}`, icon: 'folder', action: { do: 'open', machine, folder: there } })],
  }
}

/** Clone from a link: the field takes https, ssh and `host/owner/repo`, and Enter clones onto the machine named beside it. */
export function UrlLevel() {
  const shell = usePaletteShell()
  const [query, setQuery] = useState('')
  const reading = readGitUrl(query)
  const cloning = cloneView(shell)
  const target = reading.kind === 'repo' ? joinPath(shell.onto.start, reading.repo.name) : ''
  const typed: Status | null =
    reading.kind === 'repo' ? null
    : reading.kind === 'credentials' ? { tone: 'bad', title: 'Leave the user name and password out of the address', detail: 'Maiker never asks for them; git uses the sign-in that machine already has.' }
    : reading.kind === 'not-a-url' && query.trim().length >= MIN_URL_CHARS_TO_JUDGE ? { tone: 'bad', title: 'That doesn’t look like a git URL', detail: 'It should end in a repository name, like github.com/owner/repo.' }
    : { tone: 'plain', title: 'Paste a link from GitHub, GitLab or any git host', detail: 'HTTPS or SSH both work.' }
  const rows = shell.clone.kind === 'cloning' ? [] : [...(cloning?.rows ?? []), ...(reading.kind === 'repo' ? [cloneRow(reading.repo, target, shell.onto.label)] : [])]
  const onAct = (action: RowAction) => {
    if (action.do === 'clone') shell.startClone(action.label, action.address)
    else shell.act(action)
  }
  return (
    <PaletteBody
      level="url"
      mode={shell.mode}
      placeholder="Paste a git URL"
      query={query}
      onQuery={(text) => { setQuery(text); shell.forget(); shell.resetClone() }}
      onBack={shell.back}
      aside={<OntoButton shell={shell} />}
      rows={rows}
      status={shell.taking ?? cloning?.status ?? typed}
      locked={shell.locked}
      onAct={onAct}
    />
  )
}

function updatedWords(pushedAt: string): string | null {
  const at = Date.parse(pushedAt)
  return Number.isNaN(at) ? null : `updated ${ago(at / MS_PER_SECOND, Date.now() / MS_PER_SECOND)}`
}

/**
 * Clone from GitHub, through this computer's `gh`: sign in once with the link and code `gh` prints, then search the
 * account's repositories and clone one onto the machine named beside the field. The window never holds a token.
 */
export function GitHubLevel() {
  const shell = usePaletteShell()
  const [query, setQuery] = useState('')
  const github = useGitHubAccount()
  const { account, view } = github
  const signedIn = account.kind === 'signed-in'
  const repos = useGitHubRepos(query, signedIn)
  const cloning = cloneView(shell)
  const signInRow = plainRow({ id: 'sign-in', title: 'Sign in with GitHub', detail: 'Once, in your browser. Maiker only reads your repository list.', action: { do: 'sign-in' } })
  const flowing = view !== null && (view.problem !== null || view.state.kind === 'waiting' || view.state.kind === 'failed')

  let status: Status | null = null
  let rows: Row[] = []
  let more: string | null = null
  if (cloning !== null) {
    ({ status, rows } = cloning)
  } else if (flowing && view.problem === null && view.state.kind === 'waiting') {
    const { link, code } = view.state
    status = { tone: 'working', title: 'Waiting for GitHub…', detail: link === null ? 'Starting GitHub’s sign-in.' : `Enter this code at ${linkHost(link)}`, code: code ?? undefined }
    rows = [
      ...(link === null ? [] : [plainRow({ id: 'open-link', title: 'Open the link in your browser', detail: linkHost(link), icon: 'link', action: { do: 'open-link', link } })]),
      ...(code === null ? [] : [plainRow({ id: 'copy-code', title: 'Copy the code', icon: 'copy', action: { do: 'copy-code', code } })]),
      plainRow({ id: 'cancel-sign-in', title: 'Cancel the sign-in', icon: 'up', quiet: true, action: { do: 'cancel-sign-in' } }),
    ]
  } else if (flowing) {
    const failure = view.state.kind === 'failed' ? view.state.failure : null
    status = { tone: 'bad', title: 'GitHub did not sign you in', detail: view.problem ?? (failure === null ? null : failureWords('github', failure)) }
    rows = failure === 'unsupported' || failure === 'not-installed' ? [] : [{ ...signInRow, title: 'Try signing in again' }]
  } else if (account.kind === 'loading') {
    status = { tone: 'working', title: 'Looking for your GitHub account', detail: null }
  } else if (account.kind === 'no-gh') {
    status = { tone: 'plain', title: 'GitHub’s command line (gh) is not installed on this computer', detail: `Maiker signs in and lists your repositories through it. Get it from ${GH_SITE}, then open this again. Cloning from a link still works: Backspace, then Git URL.` }
  } else if (account.kind === 'unknown') {
    status = { tone: 'bad', title: 'Could not ask GitHub who is signed in', detail: `${account.why}. Cloning from a link still works: Backspace, then Git URL.` }
  } else if (account.kind === 'signed-out' || repos.result?.state === 'not-signed-in') {
    rows = [signInRow]
  } else if (repos.result === null) {
    status = { tone: 'working', title: 'Reading your repositories', detail: `Signed in as ${account.login}` }
  } else if (repos.result.state === 'failed' || repos.result.state === 'not-installed') {
    status = { tone: 'bad', title: 'The repositories could not be listed', detail: `${repos.result.state === 'failed' ? repos.result.why : 'GitHub’s command line is not installed'}. Cloning from a link still works: Backspace, then Git URL.` }
  } else {
    const typed = query.trim()
    rows = repos.rows.map((repo) => plainRow({ id: `repo:${repo.name}`, title: repo.name, detail: repo.description === '' ? updatedWords(repo.pushedAt) : repo.description, tag: repo.private ? 'Private' : null, action: { do: 'clone', label: repo.name, address: repo.cloneUrl } }))
    if (rows.length === 0) status = typed === '' ? { tone: 'plain', title: 'No repositories here yet', detail: 'Paste a full link instead: Backspace, then Git URL.' } : { tone: 'plain', title: `No repository matches “${typed}”`, detail: 'Paste a full link instead: Backspace, then Git URL.' }
    if (typed === '') rows.push(plainRow({ id: 'sign-out', title: 'Sign out of GitHub', detail: `Signed in as ${account.login}`, icon: 'up', quiet: true, action: { do: 'sign-out' } }))
    if (repos.result.listed.more) more = `Showing the first ${String(repos.rows.length)} repositories. Search to find the others.`
  }

  const onAct = (action: RowAction) => {
    if (action.do === 'clone') shell.startClone(action.label, action.address)
    else if (action.do === 'sign-in') github.signIn()
    else if (action.do === 'open-link') openSignInLink(action.link)
    else if (action.do === 'copy-code') copySignInCode(action.code)
    else if (action.do === 'cancel-sign-in') github.cancelSignIn()
    else if (action.do === 'sign-out') github.signOut()
    else shell.act(action)
  }
  const { owners } = repos
  const owner = repos.owner ?? owners[0] ?? null
  return (
    <PaletteBody
      level="github"
      mode={shell.mode}
      placeholder="Search your repositories"
      query={query}
      onQuery={(text) => { setQuery(text); shell.forget(); shell.resetClone() }}
      onBack={shell.back}
      aside={(
        <>
          {signedIn && owners.length > 1 && owner !== null && (
            <button type="button" className="mx-op-choice" aria-label={`Owner: ${owner}. Press to change the owner`} title="Show another owner's repositories" disabled={shell.locked} onClick={() => { repos.setOwner(nextOf(owners, owner)) }}>
              of <b>{owner}</b><Icon name="chevronDown" size={13} />
            </button>
          )}
          <OntoButton shell={shell} />
        </>
      )}
      rows={shell.clone.kind === 'cloning' ? [] : rows}
      status={shell.taking ?? status}
      more={more}
      locked={shell.locked}
      onAct={onAct}
    />
  )
}
