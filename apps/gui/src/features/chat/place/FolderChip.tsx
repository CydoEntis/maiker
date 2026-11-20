import { revealInExplorer } from '@/api/reveal'
import { LOCAL_MACHINE } from '@/api/machines'
import { copyText } from '@/lib/clipboard'
import { toast } from '@/lib/toast'
import { Icon } from '@/features/workspace/components/glyphs'
import { ChipMenu, type ChipItem } from '@/features/workspace/components/NewChatMenus'
import { PlaceHead } from './PlaceHead'
import type { PlaceProject } from './placeActions'

const WIDTH = 320

type Props = {
  folder: string
  /** What the chip says: the project, and the worktree after a slash when the session is in one. */
  text: string
  machine: number
  projects: readonly PlaceProject[]
  onNewSessionIn: (folder: string) => void
}

function row(key: string, label: string, onPick: () => void, extra: Partial<ChipItem> = {}): ChipItem {
  return { key, label, checked: false, onPick, ...extra }
}

/** The row under the box's folder chip: where the session runs, with the ways to copy and show it. The folder of a started session is not changed here; that is chosen before the first message. */
export function FolderChip({ folder, text, machine, projects, onNewSessionIn }: Props) {
  const copy = () => {
    copyText(folder).then(
      () => { toast.success('Path copied') },
      (error: unknown) => { toast.failed('Could not copy the path', error) },
    )
  }
  const reveal = () => {
    revealInExplorer(folder).catch((error: unknown) => { toast.failed('Could not show the folder', error) })
  }
  const here: ChipItem[] = [
    row('copy', 'Copy path', copy, { icon: <Icon name="files" size={13} /> }),
    // The file manager is this computer's: a path on another machine means nothing to it.
    ...(machine === LOCAL_MACHINE ? [row('reveal', 'Show in Explorer', reveal, { icon: <Icon name="folder" size={13} /> })] : []),
  ]
  const mine: ChipItem[] = projects.map((project) => row(project.folder, project.name, () => { onNewSessionIn(project.folder) }, { icon: <Icon name="folderPlain" size={13} /> }))
  return (
    <ChipMenu
      title={folder}
      summary={text}
      chevron={false}
      triggerClass="mx-place-chip is-folder"
      width={WIDTH}
      icon={<span className="mx-place-icon"><Icon name="folderPlain" size={13} /></span>}
      label={<span className="mx-place-text">{text}</span>}
      header={<PlaceHead mono main={folder} sub="This session runs here" />}
      sections={[
        { heading: 'This folder', quiet: true, items: here },
        ...(mine.length === 0 ? [] : [{ heading: 'New session in:', items: mine }]),
      ]}
    />
  )
}
