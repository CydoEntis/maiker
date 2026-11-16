import { useState } from 'react'
import { commitAll, createPullRequest } from './api'
import { commitTextFor } from './commitText'
import { messageOf } from './useRepoQuery'

/** What the Changes view needs to commit, sync and open a pull request: the checkout (its folder on this computer, or its pane on another machine) and a first message. */
export type ChangeActions = {
  folder: string
  suggested: string
  /** The machine the checkout is on (0: this computer). */
  machine: number
  /** On another machine, the pane there whose checkout is meant: its daemon is asked, and `folder` is not used. */
  term?: number
}

type Props = ChangeActions & {
  /** How many files changed. */
  files: number
  /** The files ticked for the commit. */
  chosen: readonly { path: string; patch: string }[]
  /** Every changed file is ticked, so the commit takes all of them, including any the list was too long to show. */
  everything: boolean
  /** The checkout changed: read it again. */
  onChanged: () => void
  onNotice: (text: string) => void
}

/** The pull request's number in its address, for "PR #12 opened"; null when the address has none. */
function pullNumber(url: string): string | null {
  return /\/pull\/(\d+)/.exec(url)?.[1] ?? null
}

/** What the commit button says: how many of the changed files it takes. */
function commitLabel(ticked: number, files: number, everything: boolean): string {
  if (ticked === 0) return 'Tick files to commit'
  if (everything) return `Commit ${String(files)} ${files === 1 ? 'file' : 'files'}`
  return `Commit ${String(ticked)} of ${String(files)} files`
}

/**
 * The Changes view's commit area (layout 2h), across the panel under the files and the diff: the message, **Commit N
 * files** (Ctrl Enter in the message) and **Create PR**. Nothing runs until a button is pressed, and each runs where the
 * checkout is: on this computer, or on the session's machine with that machine's git and GitHub sign-in.
 */
export function CommitBar({ folder, machine, term, suggested, files, chosen, everything, onChanged, onNotice }: Props) {
  const [message, setMessage] = useState(suggested)
  const [busy, setBusy] = useState<'commit' | 'pr' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [pullRequest, setPullRequest] = useState<string | null>(null)

  const run = (what: 'commit' | 'pr', work: () => Promise<void>) => {
    setBusy(what)
    setFailure(null)
    work()
      .catch((error: unknown) => { setFailure(messageOf(error)) })
      .finally(() => { setBusy(null) })
  }
  const count = everything ? files : chosen.length
  const canCommit = busy === null && message.trim() !== '' && chosen.length > 0
  const commit = () => {
    run('commit', async () => {
      const hash = await commitAll(folder, message, machine, everything ? undefined : chosen.map((file) => file.path), term)
      onNotice(`Committed ${String(count)} ${count === 1 ? 'file' : 'files'} as ${hash}`)
      setMessage('')
      onChanged()
    })
  }
  const openPullRequest = () => {
    run('pr', async () => {
      const url = await createPullRequest(folder, machine, term)
      setPullRequest(url)
      onNotice('Pull request opened')
    })
  }
  const number = pullRequest === null ? null : pullNumber(pullRequest)

  return (
    <div className="mx-commit">
      {/* With nothing changed there is nothing to commit; the branch can still go up as a pull request. */}
      {files > 0 && (
        <textarea
          className="mx-commit-message"
          aria-label="Commit message"
          placeholder="Summary on the first line, then details"
          rows={4}
          value={message}
          disabled={busy !== null}
          onChange={(event) => { setMessage(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && canCommit) {
              event.preventDefault()
              commit()
            }
          }}
        />
      )}
      <div className="mx-commit-actions">
        {files > 0 && (
          <button type="button" className="mx-commit-go" disabled={!canCommit} onClick={commit}>
            {busy === 'commit' ? 'Committing…' : commitLabel(chosen.length, files, everything)}
            {chosen.length > 0 && busy !== 'commit' && <kbd aria-hidden="true">Ctrl ⏎</kbd>}
          </button>
        )}
        <button type="button" className="mx-commit-soft" disabled={busy !== null} title="Pushes this branch and opens a pull request for it with GitHub's gh" onClick={openPullRequest}>
          {busy === 'pr' ? 'Opening…' : pullRequest !== null && number !== null ? `PR #${number} opened` : 'Create PR'}
        </button>
        <span className="mx-spacer" />
        {files > 0 && <button type="button" className="mx-commit-text" disabled={busy !== null || chosen.length === 0} title="Writes a first message from the files that will be committed" onClick={() => { setMessage(commitTextFor(chosen)) }}>Suggest a message</button>}
      </div>
      {failure !== null && <p className="mx-commit-error" role="alert">{failure}</p>}
      {pullRequest !== null && <p className="mx-commit-done">✓ Opened pull request{number === null ? '' : ` #${number}`} · <span>{pullRequest}</span></p>}
    </div>
  )
}
