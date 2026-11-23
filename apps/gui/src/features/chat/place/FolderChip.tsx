import { revealInExplorer } from '@/api/reveal'
import { LOCAL_MACHINE } from '@/api/machines'
import { copyText } from '@/lib/clipboard'
import { toast } from '@/lib/toast'
import { Icon } from '@/features/workspace/components/glyphs'
import { ChipMenu, type ChipItem } from '@/features/workspace/components/NewChatMenus'
import { PlaceHead } from './PlaceHead'
import type { PlaceProject } from './placeActions'
import type { FolderPicking } from './picking'

const WIDTH = 300

type Props = {
  folder: string
  /** What the chip says: the project, and the worktree after a slash when the session is in one. */
  text: string
  machine: number
  projects: readonly PlaceProject[]
  /** The machine's name when it is not this computer; the menu's head says the session runs there. */
  machineName?: string | null | undefined
  onNewSessionIn: (folder: string) => void
  /** Given for a draft: the menu chooses the folder the session will run in, instead of only showing it. */
  picking?: FolderPicking | undefined
  /** The large chip over an empty draft: a chevron, and the list opens downward. */
  hero?: boolean
}

function row(key: string, label: string, onPick: () => void, extra: Partial<ChipItem> = {}): ChipItem {
  return { key, label, checked: false, onPick, ...extra }
}

/** The row under the box's folder chip: where the session runs, with the ways to copy and show it. The folder of a started session is not changed here; that is chosen before the first message. */
export function FolderChip({ folder, text, machine, projects, machineName = null, onNewSessionIn, picking, hero = false }: Props) {
  const copy = () => {
    copyText(folder).then(
      () => { toast.success('Path copied') },
      (error: unknown) => { toast.failed('Could not copy the path', error) },
    )
  }
  const reveal = () => {
    revealInExplorer(folder).catch((error: unknown) => { toast.failed('Could not show the folder', error) })
  }
  // No folder is chosen yet, so there is nothing to copy or show.
  const here: ChipItem[] = folder === '' ? [] : [
    row('copy', 'Copy path', copy, { icon: <Icon name="copy" size={13} /> }),
    // The file manager is this computer's: a path on another machine means nothing to it.
    ...(machine === LOCAL_MACHINE ? [row('reveal', 'Show in Explorer', reveal, { icon: <Icon name="arrowUpRight" size={13} /> })] : []),
  ]
  const mine: ChipItem[] = projects.map((project) => row(project.folder, project.name, () => { onNewSessionIn(project.folder) }, { icon: <Icon name="folderPlain" size={13} />, checked: project.folder === folder }))
  const hereSection = here.length === 0 ? [] : [{ heading: 'This folder', quiet: true, items: here }]
  return (
    <ChipMenu
      title={hero ? 'Project' : folder === '' ? 'Folder' : folder}
      summary={text}
      chevron={hero}
      side={hero ? 'bottom' : 'top'}
      variant="place"
      triggerClass={`mx-place-chip is-folder${hero ? ' is-hero' : ''}`}
      width={WIDTH}
      icon={<span className="mx-place-icon"><Icon name="folderPlain" size={13} /></span>}
      label={<span className="mx-place-text">{text}</span>}
      header={<PlaceHead mono={folder !== ''} main={folder === '' ? 'No folder yet' : folder} sub={picking === undefined ? (machineName === null ? 'This session runs here' : `This session runs here on ${machineName}`) : folder === '' ? 'Choose where it runs' : 'The session will run here'} />}
      sections={picking === undefined ? [...hereSection, ...(mine.length === 0 ? [] : [{ heading: 'New session in', ruled: true, items: mine }])] : [...hereSection, ...picking.sections]}
      {...(picking === undefined ? {} : { search: picking.search, fromQuery: picking.fromQuery, footer: picking.footer })}
    />
  )
}
