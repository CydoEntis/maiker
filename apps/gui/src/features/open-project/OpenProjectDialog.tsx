import { useState } from 'react'
import { X } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import type { GitHubRepo } from '@/api/githubRepos'
import { FolderPanel } from './FolderPanel'
import { GitHubPanel } from './GitHubPanel'
import { ProjectStatus } from './ProjectStatus'
import { UrlPanel } from './UrlPanel'
import { repoLabel } from './repoUrl'
import { useCloneProject } from './useCloneProject'
import { useFoundProjects } from './useFoundProjects'
import { useGitHubAccount } from './useGitHubAccount'
import { useFolderForm, useUrlForm } from './useOpenForms'
import './open-project.css'

export type OpenProjectTab = 'url' | 'github' | 'folder'

const TAB_LABELS: Readonly<Record<OpenProjectTab, string>> = { url: 'Clone from URL', github: 'GitHub', folder: 'On this computer' }
const TABS = Object.keys(TAB_LABELS) as OpenProjectTab[]

type Props = {
  tab: OpenProjectTab
  /** This computer's home folder: where a clone goes unless it is changed, and where projects are looked for. */
  home: string
  /** Opens the system's folder picker at the given text; null when it is cancelled. */
  chooseFolder: (current: string) => Promise<string | null>
  /** Whether a typed folder is there. */
  folderExists: (path: string) => Promise<boolean>
  /** Starts a session in the project that is ready. */
  onStartSession: (folder: string) => void
  onClose: () => void
}

function GitHubTab({ disabled, folderOf, onClone, onOpen }: { disabled: boolean; folderOf: (repo: GitHubRepo) => string | null; onClone: (repo: GitHubRepo) => void; onOpen: (folder: string) => void }) {
  const github = useGitHubAccount()
  return <GitHubPanel {...github} disabled={disabled} folderOf={folderOf} onClone={onClone} onOpen={onOpen} />
}

/**
 * Open a project, on this computer: clone one from a URL, clone or open one of the GitHub account's repositories, or open a
 * folder that is already there. One project at a time: while a clone runs the dialog stays (it cannot be taken back), and
 * when the project is ready the main button starts a session in it.
 */
export function OpenProjectDialog({ tab: first, home, chooseFolder, folderExists, onStartSession, onClose }: Props) {
  const [tab, setTab] = useState(first)
  const [folderProblem, setFolderProblem] = useState<string | null>(null)
  const urlForm = useUrlForm(home)
  const folderForm = useFolderForm()
  const found = useFoundProjects(home)
  const project = useCloneProject()
  const { state } = project
  const cloning = state.kind === 'cloning'
  const ready = state.kind === 'ready' ? state : null
  const parentForGitHub = home === '' ? '~' : home

  const folderOf = (repo: GitHubRepo): string | null => {
    const name = (repo.name.split('/').at(-1) ?? repo.name).toLowerCase()
    return project.cloned.get(name) ?? found.find((one) => one.name.toLowerCase() === name)?.path ?? null
  }
  const cloneFromUrl = () => {
    if (urlForm.repo !== null && !cloning) project.clone(repoLabel(urlForm.repo), urlForm.repo.address, urlForm.parent)
  }
  const openTyped = () => {
    const typed = folderForm.folder.trim()
    if (typed === '' || cloning) return
    folderExists(typed).then(
      (there) => {
        setFolderProblem(there ? null : 'That folder is not there. Check the path, or use Browse.')
        if (there) project.open(typed)
      },
      () => { setFolderProblem('Could not check that folder. Try Browse instead.') },
    )
  }
  const start = (folder: string) => {
    onStartSession(folder)
    onClose()
  }
  const changeTab = (next: string) => {
    setTab(next as OpenProjectTab)
    setFolderProblem(null)
    project.reset()
  }

  const primary = ready !== null
    ? { label: `Start a session in ${ready.name}`, disabled: false, run: () => { start(ready.folder) } }
    : cloning ? { label: 'Cloning…', disabled: true, run: () => undefined }
      : tab === 'url' ? { label: 'Clone', disabled: urlForm.repo === null, run: cloneFromUrl }
        : tab === 'folder' ? { label: 'Open', disabled: !folderForm.ready, run: openTyped }
          : { label: 'Done', disabled: false, run: onClose }

  return (
    // A clone that is running cannot be taken back, so the dialog stays until it has ended.
    <Dialog open onOpenChange={(isOpen) => { if (!isOpen && !cloning) onClose() }}>
      <DialogContent unstyled asChild aria-describedby={undefined}>
        <div
          aria-label="Open a project"
          className="mx-rename mx-op"
          onKeyDown={(event) => {
            // Radix closes on Escape; this keeps the key from reaching the app's own handlers.
            if (event.key === 'Escape') event.stopPropagation()
          }}
        >
          <div className="mx-op-head">
            <DialogTitle asChild><h2>Open a project</h2></DialogTitle>
            <IconButton label="Close" disabled={cloning} onClick={onClose}><X /></IconButton>
          </div>
          <Segmented aria-label="Where the project is" full value={tab} onValueChange={changeTab} disabled={cloning}>
            {TABS.map((name) => <SegmentedItem key={name} value={name}>{TAB_LABELS[name]}</SegmentedItem>)}
          </Segmented>
          {tab === 'url' && <UrlPanel form={urlForm} disabled={cloning} onSubmit={primary.run} />}
          {tab === 'github' && <GitHubTab disabled={cloning} folderOf={folderOf} onClone={(repo) => { project.clone(repo.name, repo.cloneUrl, parentForGitHub) }} onOpen={project.open} />}
          {tab === 'folder' && <FolderPanel form={folderForm} found={found} disabled={cloning} onBrowse={chooseFolder} problem={folderProblem} onSubmit={primary.run} />}
          <ProjectStatus state={state} onUseExisting={project.open} />
          <div className="mx-rename-actions">
            <Button variant="ghost" disabled={cloning} onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={primary.disabled} onClick={primary.run}>{primary.label}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
