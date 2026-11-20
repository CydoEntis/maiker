import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ModalBody, ModalFoot, ModalHead } from '@/components/ui/modal'
import { Tab, TabList, Tabs } from '@/components/ui/tabs'
import { InlineNote } from '@/components/ui/feedback'
import { errorMessage } from '@/lib/error-message'
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

/**
 * What the project is brought in for: a session started in it, or the project alone, kept in the sidebar with no session.
 * `onOpenProject` rejects with the reason the folder cannot be opened, and the dialog then stays and shows it.
 */
export type OpenProjectPurpose =
  | { kind: 'session'; onStartSession: (folder: string) => void }
  | { kind: 'project'; onOpenProject: (folder: string) => Promise<void> }

type Props = {
  tab: OpenProjectTab
  /** This computer's home folder: where a clone goes unless it is changed, and where projects are looked for. */
  home: string
  /** Opens the system's folder picker at the given text; null when it is cancelled. */
  chooseFolder: (current: string) => Promise<string | null>
  /** Whether a typed folder is there. */
  folderExists: (path: string) => Promise<boolean>
  purpose: OpenProjectPurpose
  onClose: () => void
}

function GitHubTab({ disabled, folderOf, onClone, onOpen }: { disabled: boolean; folderOf: (repo: GitHubRepo) => string | null; onClone: (repo: GitHubRepo) => void; onOpen: (folder: string) => void }) {
  const github = useGitHubAccount()
  return <GitHubPanel {...github} disabled={disabled} folderOf={folderOf} onClone={onClone} onOpen={onOpen} />
}

/**
 * Open a project, on this computer: clone one from a URL, clone or open one of the GitHub account's repositories, or open a
 * folder that is already there. One project at a time: while a clone runs the dialog stays (it cannot be taken back), and
 * when the project is ready the main button starts a session in it. Opened for the project alone, a folder that is there
 * is opened at once, and a clone when it is done.
 */
export function OpenProjectDialog({ tab: first, home, chooseFolder, folderExists, purpose, onClose }: Props) {
  const [tab, setTab] = useState(first)
  const [folderProblem, setFolderProblem] = useState<string | null>(null)
  const [openProblem, setOpenProblem] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const urlForm = useUrlForm(home)
  const folderForm = useFolderForm()
  const found = useFoundProjects(home)
  const project = useCloneProject()
  const { state } = project
  const cloning = state.kind === 'cloning'
  const busy = cloning || opening
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
    if (typed === '' || busy) return
    folderExists(typed).then(
      (there) => {
        setFolderProblem(there ? null : 'That folder is not there. Check the path, or use Browse.')
        if (there) takeFolder(typed)
      },
      () => { setFolderProblem('Could not check that folder. Try Browse instead.') },
    )
  }
  const finish = (folder: string) => {
    if (purpose.kind === 'session') {
      purpose.onStartSession(folder)
      onClose()
      return
    }
    setOpening(true)
    setOpenProblem(null)
    purpose.onOpenProject(folder).then(onClose, (error: unknown) => {
      setOpening(false)
      setOpenProblem(errorMessage(error, 'The folder could not be read'))
    })
  }
  // A session is started from the ready project with the main button; the project alone needs no second step.
  const takeFolder = purpose.kind === 'project' ? finish : project.open
  const changeTab = (next: string) => {
    setTab(next as OpenProjectTab)
    setFolderProblem(null)
    setOpenProblem(null)
    project.reset()
  }

  const primary = opening ? { label: 'Opening…', disabled: true, run: () => undefined }
    : ready !== null
    ? { label: purpose.kind === 'session' ? `Start a session in ${ready.name}` : `Open ${ready.name}`, disabled: false, run: () => { finish(ready.folder) } }
    : cloning ? { label: 'Cloning…', disabled: true, run: () => undefined }
      : tab === 'url' ? { label: 'Clone', disabled: urlForm.repo === null, run: cloneFromUrl }
        : tab === 'folder' ? { label: 'Open', disabled: !folderForm.ready, run: openTyped }
          : { label: 'Done', disabled: false, run: onClose }

  return (
    // A clone that is running cannot be taken back, so the dialog stays until it has ended, and while a project is read to open it.
    <Dialog open onOpenChange={(isOpen) => { if (!isOpen && !busy) onClose() }}>
      <DialogContent unstyled asChild aria-describedby={undefined}>
        <div
          aria-label="Open a project"
          className="mx-rename mx-modal"
          onKeyDown={(event) => {
            // Radix closes on Escape; this keeps the key from reaching the app's own handlers.
            if (event.key === 'Escape') event.stopPropagation()
          }}
        >
          <ModalHead title="Open a project" onClose={onClose} closeDisabled={busy} />
          <Tabs value={tab} onValueChange={changeTab}>
            <TabList aria-label="Where the project is">
              {TABS.map((name) => <Tab key={name} value={name} disabled={busy}>{TAB_LABELS[name]}</Tab>)}
            </TabList>
          </Tabs>
          <ModalBody>
            {tab === 'url' && <UrlPanel form={urlForm} disabled={busy} onSubmit={primary.run} />}
            {tab === 'github' && <GitHubTab disabled={busy} folderOf={folderOf} onClone={(repo) => { project.clone(repo.name, repo.cloneUrl, parentForGitHub) }} onOpen={takeFolder} />}
            {tab === 'folder' && <FolderPanel form={folderForm} found={found} disabled={busy} onBrowse={chooseFolder} problem={folderProblem} onSubmit={primary.run} />}
            <ProjectStatus state={state} onUseExisting={takeFolder} />
            {openProblem !== null && <InlineNote title="Could not open the project" reason={openProblem} />}
          </ModalBody>
          <ModalFoot left={<Button variant="ghost" size="lg" disabled={busy} onClick={onClose}>Cancel</Button>}>
            <Button variant="primary" size="xl" disabled={primary.disabled} onClick={primary.run}>{primary.label}</Button>
          </ModalFoot>
        </div>
      </DialogContent>
    </Dialog>
  )
}
