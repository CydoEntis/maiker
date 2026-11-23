import { LOCAL_MACHINE } from '@/api/machines'
import { useState, type MouseEvent } from 'react'
import { TypeTag } from '@/components/ui/tag'
import { Icon } from '@/features/workspace/components/glyphs'
import { readmeOf } from '@/features/documents/documentPaths'
import { repoDiff, repoTree } from './api'
import { changeKind, type ChangeKind } from './changeKind'
import { CHANGES_REFRESH_MS } from './ChangesTab'
import { type FileActions, useFileMenu } from './fileMenu'
import { fileTag, foldersHolding } from './fileTag'
import { joinPath } from './format'
import { RepoError } from './RepoError'
import { useRepoQuery } from './useRepoQuery'

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function FileName({ name }: { name: string }) {
  const tag = fileTag(name)
  return <>{tag !== null && <span className="mx-files-tag" aria-hidden="true"><TypeTag tag={tag} /></span>}<span className="mx-files-name">{name}</span></>
}

/** A tree row's left padding: a base, then one step in for each folder level. */
const ROW_PAD_PX = 8
const LEVEL_PAD_PX = 14

/** How many bars stand in for the file list while it is read; the stylesheet gives them their widths. */
const TREE_BARS = 8

/**
 * The shape of what is being read, so the panel does not jump when it arrives. Still on purpose:
 * the wait is short, and an animation here repaints the panel every frame (docs/PERFORMANCE.md).
 * Not a status region: that role is the tab's own note, such as a folder that is not a repository.
 */
function Bars({ label, count, className }: { label: string; count: number; className: string }) {
  return (
    <div aria-busy="true" className={className}>
      <p className="sr-only">{label}</p>
      {Array.from({ length: count }, (_, index) => <span key={index} aria-hidden="true" />)}
    </div>
  )
}

/**
 * The repository's files: the changed ones listed first, then the tree (folders open in place, each read when first
 * opened). A click opens the file in the file pane; the panel itself shows no file.
 */
export function FilesTab({ term, machine = LOCAL_MACHINE, files, onReferences }: { term: number; /** The machine the session is on, whose daemon lists the folders. */ machine?: number; files: FileActions; /** Opens the project's references, the first entry of the tree. */ onReferences?: () => void }) {
  const machineKey = machine === LOCAL_MACHINE ? [] : [machine]
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const menu = useFileMenu('files', files)

  // The top folder is read by the tree too, under the same key, so this costs no second read.
  const top = useRepoQuery(term, ['tree', '', ...machineKey], () => repoTree(term, null, machine))
  // The same query the Changes tab keeps, so the two never disagree and it is read once.
  const diff = useRepoQuery(term, ['diff', ...machineKey], () => repoDiff(term, null, machine), CHANGES_REFRESH_MS)
  const changed = new Map<string, ChangeKind>((diff.data?.files ?? []).map((entry) => [entry.path, changeKind(entry.patch)]))
  const marked = foldersHolding([...changed.keys()])
  const readme = readmeOf((top.data ?? []).filter((entry) => !entry.is_directory).map((entry) => entry.name))
  const pick = (path: string) => { files.onOpen(path, 'files') }
  const menuOf = (event: MouseEvent, path: string) => { menu.open(event, { path, changed: changed.has(path), deleted: changed.get(path)?.letter === 'D', added: changed.get(path)?.letter === 'A' }) }
  const toggle = (folder: string) => {
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(folder)) next.add(folder)
      return next
    })
  }

  return (
    <div className="mx-files">
      <nav className="mx-files-tree" aria-label="Files">
        {onReferences !== undefined && (
          <button type="button" className="mx-files-refs" title="References agents look at before UI work" onClick={onReferences}>
            <Icon name="references" size={13} />
            <span>References</span>
            <Icon name="chevron" />
          </button>
        )}
        {changed.size > 0 && (
          <>
            <p className="mx-files-heading">Changed</p>
            <ul className="mx-files-list" aria-label="Changed files">
              {[...changed].map(([path, kind]) => (
                <li key={path}>
                  <button type="button" className={`mx-files-row${path === files.openPath ? ' is-current' : ''}`} aria-current={path === files.openPath ? 'true' : undefined} style={{ paddingLeft: `${String(ROW_PAD_PX)}px` }} title={path} onClick={() => { pick(path) }} onContextMenu={(event) => { menuOf(event, path) }}>
                    <FileName name={baseName(path)} />
                    <span className={`mx-files-mark is-${kind.tone}`} title={kind.word}>{kind.letter}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mx-files-heading">All files</p>
          </>
        )}
        {readme !== null && (
          <button type="button" className="mx-files-refs" onClick={() => { pick(readme) }} onContextMenu={(event) => { menuOf(event, readme) }}>
            <Icon name="references" size={13} />
            <span>README</span>
            <Icon name="chevron" />
          </button>
        )}
        <Folder term={term} machine={machine} folder="" depth={0} open={open} file={files.openPath} changed={changed} marked={marked} onToggle={toggle} onPick={pick} onMenu={menuOf} />
      </nav>
      {menu.popup}
    </div>
  )
}

type FolderProps = { term: number; machine: number; folder: string; depth: number; open: ReadonlySet<string>; file: string | null; changed: ReadonlyMap<string, ChangeKind>; marked: ReadonlySet<string>; onToggle: (folder: string) => void; onPick: (path: string) => void; onMenu: (event: MouseEvent, path: string) => void }

/** One folder's entries; a folder inside it that is open reads and shows its own. */
function Folder({ term, machine, folder, depth, open, file, changed, marked, onToggle, onPick, onMenu }: FolderProps) {
  const tree = useRepoQuery(term, ['tree', folder, ...(machine === LOCAL_MACHINE ? [] : [machine])], () => repoTree(term, folder || null, machine))
  if (tree.isPending) return depth === 0 ? <Bars label="Reading the files" count={TREE_BARS} className="mx-files-wait" /> : null
  if (tree.isError) return <RepoError error={tree.error} tab="files" onRetry={() => { void tree.refetch() }} retrying={tree.isFetching} />
  return (
    <ul className="mx-files-list">
      {tree.data.map((entry) => {
        const path = joinPath(folder, entry.name)
        const indent = { paddingLeft: `${String(ROW_PAD_PX + depth * LEVEL_PAD_PX)}px` }
        if (!entry.is_directory) {
          return (
            <li key={entry.name}>
              <button type="button" className={`mx-files-row${path === file ? ' is-current' : ''}`} aria-current={path === file ? 'true' : undefined} style={indent} onClick={() => { onPick(path) }} onContextMenu={(event) => { onMenu(event, path) }}>
                <span className="mx-files-twist" aria-hidden="true" />
                <FileName name={entry.name} />
                {changed.has(path) && <span className={`mx-files-mark is-${changed.get(path)?.tone ?? 'edit'}`} title={changed.get(path)?.word}>{changed.get(path)?.letter}</span>}
              </button>
            </li>
          )
        }
        const isOpen = open.has(path)
        return (
          <li key={entry.name}>
            <button type="button" className="mx-files-row is-folder" style={indent} aria-expanded={isOpen} onClick={() => { onToggle(path) }}>
              <span className={`mx-files-twist${isOpen ? ' is-open' : ''}`} aria-hidden="true"><Icon name="chevronDown" size={11} /></span>
              <span className="mx-files-name">{entry.name}</span>
              {marked.has(path) && <span className="mx-files-dot" role="img" aria-label="Holds changed files" />}
            </button>
            {isOpen && <Folder term={term} machine={machine} folder={path} depth={depth + 1} open={open} file={file} changed={changed} marked={marked} onToggle={onToggle} onPick={onPick} onMenu={onMenu} />}
          </li>
        )
      })}
    </ul>
  )
}
