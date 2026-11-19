import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { cloneRepository } from '@/api/cloneRepository'
import { loadGitHubOwners, loadGitHubRepos } from '@/api/githubRepos'
import { loadGitIdentities, ruleCovering, type GitIdentityRule } from '@/api/gitIdentities'
import { lastCloneDestination, rememberCloneDestination } from '../model/cloneDestination'
import { cloneParentFor } from '../model/repoAddress'
import { CloneRepoDialog } from './CloneRepoDialog'

type Target = {
  machine: number
  /** The machine as the dialog names it: "this computer" or its name. */
  where: string
  chooseFolder: (() => Promise<string | null>) | null
  /** Opens Settings on the GitHub page, for a machine that is not signed in. The dialog closes first. */
  onOpenGitHubSettings: () => void
}

const NO_RULES: readonly GitIdentityRule[] = []

/**
 * The machine's folder rules, read each time the dialog opens. A machine that cannot say has none:
 * the dialog then names no account, as it does for a folder no rule covers.
 */
function useFolderRules(machine: number, open: boolean): readonly GitIdentityRule[] {
  const [rules, setRules] = useState(NO_RULES)
  useEffect(() => {
    if (!open) return undefined
    let current = true
    loadGitIdentities(machine).then(
      (report) => { if (current) setRules(report.rules) },
      // shortcut: the account line is a hint; a machine that could not be asked shows no line rather than an error in the clone dialog.
      () => { if (current) setRules(NO_RULES) },
    )
    return () => { current = false }
  }, [machine, open])
  return rules
}

/** What the clone window opens with: its first view, and an address and folder already filled in (a clone that needs another folder). */
export type CloneOpening = { start: 'link' | 'repos'; address?: string; parent?: string }

/**
 * The New session dialog's way to bring a repository onto a machine: `run` clones one for the dialog's own row, and
 * `open` shows the clone window and answers with the cloned folder, or null when it is cancelled, the way Browse
 * answers with a chosen one. `parent` is the folder a clone goes inside unless said otherwise: the last one used on that
 * machine, else `~/Projects`, which the daemon makes on first use.
 */
export function useCloneRepo({ machine, where, chooseFolder, onOpenGitHubSettings }: Target): { open: (opening?: CloneOpening) => Promise<string | null>; dialog: ReactNode; run: (address: string, parent: string) => Promise<string>; parent: string; remember: (parent: string) => void } {
  const [answer, setAnswer] = useState<{ resolve: (folder: string | null) => void; opening: CloneOpening } | null>(null)
  const open = useCallback((opening: CloneOpening = { start: 'link' }) => new Promise<string | null>((resolve) => { setAnswer({ resolve, opening }) }), [])
  const parent = cloneParentFor(lastCloneDestination(where))
  const remember = useCallback((chosen: string) => { rememberCloneDestination(where, chosen) }, [where])
  const clone = useCallback((address: string, parent: string) => cloneRepository(machine, address, parent), [machine])
  const loadOwners = useCallback(() => loadGitHubOwners(machine), [machine])
  const loadRepos = useCallback((owner: string | null, search: string) => loadGitHubRepos(machine, owner, search), [machine])
  const rules = useFolderRules(machine, answer !== null)
  const accountFor = useCallback((parent: string) => ruleCovering(rules, parent)?.login ?? null, [rules])
  const settle = (folder: string | null) => {
    answer?.resolve(folder)
    setAnswer(null)
  }
  const dialog = answer === null ? null : (
    <CloneRepoDialog
      where={where}
      startIn={answer.opening.parent ?? parent}
      initialAddress={answer.opening.address ?? ''}
      reposFirst={answer.opening.start === 'repos'}
      chooseFolder={chooseFolder}
      clone={clone}
      github={{ loadOwners, loadRepos, onOpenSettings: () => { settle(null); onOpenGitHubSettings() } }}
      accountFor={accountFor}
      onCloned={(folder, parent) => {
        rememberCloneDestination(where, parent)
        settle(folder)
      }}
      onCancel={() => { settle(null) }}
    />
  )
  return { open, dialog, run: clone, parent, remember }
}
