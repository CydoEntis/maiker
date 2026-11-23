import { useEffect, useState } from 'react'
import { errorMessage } from '@/lib/error-message'
import { isRoot, joinPath, niceOf, parentOf } from '@/features/workspace/model/folderPick'
import { PaletteBody, type Status } from './PaletteBody'
import { HOME_FOLDER, crumbOf, folderRows, ignoresCase, typedFolder, type Level, type RowAction } from './openPalette'
import { usePaletteShell } from './paletteShell'
import { useFolderListing } from './useFolderListing'

type Making = { state: 'making'; name: string } | { state: 'refused'; name: string; why: string } | null

/**
 * The folder browser, the same on every machine: `..` then the folders of the one shown, read through the palette's
 * one `list`. Enter opens a repository or goes into a folder, Right arrow and Tab go into a repository, a typed name
 * and a separator go in, Backspace on an empty field goes up, Ctrl+Enter takes the folder shown.
 */
export function BrowseLevel({ level }: { level: Extract<Level, { kind: 'browse' }> }) {
  const shell = usePaletteShell()
  const machine = shell.machineOf(level.machine)
  const { learnHome } = shell
  const [query, setQuery] = useState('')
  const [making, setMaking] = useState<Making>(null)
  const { read, again } = useFolderListing(shell.services.list, machine.machine, level.path, machine.ready)
  const listing = read.state === 'listed' && read.listing.exists ? read.listing : null
  const here = listing?.path ?? null
  const home = shell.homeOf(machine.machine)
  const ignoreCase = ignoresCase(here ?? level.path, shell.osOf(machine))

  useEffect(() => {
    if (level.path === HOME_FOLDER && here !== null) learnHome(machine.machine, here)
  }, [level.path, here, machine.machine, learnHome])

  const go = (path: string) => { shell.go({ kind: 'browse', machine: machine.machine, path }) }
  const up = () => {
    const from = here ?? level.path
    // Above a root, and above a folder nobody could read from its `~`, is the list of sources.
    if (isRoot(from) || from === HOME_FOLDER || parentOf(from) === from) shell.back()
    else go(parentOf(from))
  }
  const onQuery = (text: string) => {
    setMaking(null)
    shell.forget()
    const typed = listing === null || here === null ? null : typedFolder(listing.entries, text, ignoreCase)
    if (typed === '..') up()
    else if (typed !== null && here !== null) go(joinPath(here, typed))
    else setQuery(text)
  }
  const makeFolder = (name: string) => {
    if (here === null) return
    setMaking({ state: 'making', name })
    shell.services.create(machine.machine, here, name).then(
      (outcome) => {
        if (outcome.kind === 'created') go(outcome.path)
        else setMaking({ state: 'refused', name, why: outcome.kind === 'exists' ? `A folder called ${name} is already here.` : outcome.reason })
      },
      (error: unknown) => { setMaking({ state: 'refused', name, why: errorMessage(error, `Could not make the folder on ${machine.label}`) }) },
    )
  }
  const onAct = (action: RowAction) => {
    if (action.do === 'create-folder') makeFolder(action.name)
    else shell.act(action)
  }

  const view = listing === null ? { rows: [], note: null } : folderRows({ mode: shell.mode, machine: machine.machine, listing, query, open: shell.openOn(machine), ignoreCase, home })
  const where = niceOf(here ?? level.path, home)
  const tryAgain = { label: 'Try again', run: again }
  const own: Status | null =
    making?.state === 'making' ? { tone: 'working', title: `Making ${making.name}`, detail: `in ${where} on ${machine.label}` }
    : making?.state === 'refused' ? { tone: 'bad', title: `Could not make ${making.name}`, detail: making.why }
    : read.state === 'idle' ? { tone: 'offline', title: `${machine.label} is offline`, detail: machine.why ?? 'Maiker keeps trying in the background.', action: tryAgain }
    : read.state === 'failed' ? { tone: 'offline', title: `${machine.label} did not answer`, detail: read.why, action: tryAgain }
    : read.state === 'reading' ? (read.late ? { tone: 'working', title: `Listing ${where}`, detail: `on ${machine.label}` } : null)
    : !read.listing.exists ? { tone: 'plain', title: `There is no folder ${read.listing.path} on ${machine.label}`, detail: 'Or it cannot be read. Backspace goes back.' }
    : view.note === 'empty' ? { tone: 'plain', title: 'This folder is empty', detail: shell.mode === 'open' ? 'Open it anyway to start something new here.' : 'Choose it anyway, or type a name to make a folder in it.' }
    : view.note === 'no-match' ? { tone: 'plain', title: `No folder here matches “${query.trim()}”`, detail: 'Backspace clears the filter, then goes up a level.' }
    : null
  const locked = shell.locked || making?.state === 'making'
  const takeHere = () => { if (here !== null && !locked) shell.take(machine.machine, here) }
  const { chooseSystemFolder } = shell.services
  const useSystem = chooseSystemFolder === null || machine.name !== null || query !== '' ? null : () => {
    void chooseSystemFolder(here ?? '').then((folder) => { if (folder !== null) shell.take(machine.machine, folder) })
  }

  return (
    <PaletteBody
      level="browse"
      mode={shell.mode}
      placeholder="Filter, or type a folder name"
      query={query}
      onQuery={onQuery}
      onBack={shell.back}
      crumb={{ machine: machine.label, remote: machine.name !== null, path: crumbOf(here ?? level.path, home), full: here ?? level.path }}
      rows={making?.state === 'making' ? [] : view.rows}
      status={shell.taking ?? own}
      more={listing?.truncated === true ? `Showing the first ${String(listing.entries.length)} folders. Type a path to reach another.` : null}
      locked={locked}
      onAct={onAct}
      onInto={go}
      onUp={up}
      onOpenHere={takeHere}
      actions={(
        <>
          {useSystem !== null && <button type="button" className="mx-op-system" disabled={locked} onClick={useSystem}>Use system dialog…</button>}
          <button type="button" className="mx-op-primary" title="Ctrl+Enter" disabled={here === null || locked} onClick={takeHere}>{shell.mode === 'open' ? 'Open this folder' : 'Choose this folder'}</button>
        </>
      )}
    />
  )
}
