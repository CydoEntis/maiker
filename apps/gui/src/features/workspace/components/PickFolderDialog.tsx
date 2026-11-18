import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import { Popover } from 'radix-ui'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { MLoader } from '@/components/ui/m-loader'
import { ChoiceItem, ChoiceList } from '@/components/ui/choice-list'
import { PopupContent } from '@/components/ui/popup'
import { ResultsList, ResultsOption } from '@/components/ui/results-list'
import { Switch } from '@/components/ui/switch'
import type { CreateFolderOutcome, FolderListing } from '@/api/folders'
import { errorMessage } from '@/lib/error-message'
import { folderNameProblem } from '../model/folderName'
import { baseName, crumbsOf, isPathQuery, isRoot, joinPath, niceOf, parentOf, visibleFolders, type PickedFolder } from '../model/folderPick'
import { Icon } from './glyphs'

/** Longest path the host accepts. */
const MOST_PATH_CHARS = 4096

/** Where browsing a machine starts: its home folder. */
const START_FOLDER = '~'

/** A read shorter than this shows no loader: a flash of the M for a local read is noise. */
const LOADER_DELAY_MS = 160

/** A machine the picker can read: `word` says why it cannot be, when it cannot. */
export type PickerMachine = { machine: number; label: string; ready: boolean; word: string | null }

type Read<Value> = { key: string; result: { state: 'ready'; value: Value } | { state: 'failed'; why: string } }

type Props = {
  machines: readonly PickerMachine[]
  /** The machine the picker opens on. */
  machine: number
  list: (machine: number, path: string) => Promise<FolderListing>
  /** Makes the folder `name` directly inside `parent` on a machine; the machine's daemon decides. */
  create: (machine: number, parent: string, name: string) => Promise<CreateFolderOutcome>
  onPick: (picked: PickedFolder) => void
  onCancel: () => void
}

/** True once the wait named `key` has gone on for `LOADER_DELAY_MS`; a new wait starts the count again. */
function useAfterDelay(waiting: boolean, key: string): boolean {
  const [late, setLate] = useState<string | null>(null)
  useEffect(() => {
    if (!waiting) return undefined
    const timer = window.setTimeout(() => { setLate(key) }, LOADER_DELAY_MS)
    return () => { window.clearTimeout(timer) }
  }, [waiting, key])
  return waiting && late === key
}

/**
 * Open a folder on a machine. The machine is a list in the title; its folders are browsed one by one (a repository is just a
 * folder, with its branch beside it); one input filters the rows, or jumps when it starts with `/` or `~`. Up and Down
 * select, Enter goes into a folder, Right goes into a folder, Backspace goes up, Ctrl+Enter chooses, Ctrl+Shift+N makes a
 * new folder here (a field at the top of the list: Enter creates, Esc cancels), Esc clears the input and then closes.
 * Every name shown came from the machine's daemon, and so does every folder made.
 */
export function PickFolderDialog({ machines, machine: first, list, create, onPick, onCancel }: Props) {
  const [machine, setMachine] = useState(first)
  // The window's root, where the theme's variables live; read once, so the dialog's portal never moves.
  const [root] = useState(() => window.document.querySelector<HTMLElement>('.mx-app'))
  const [dir, setDir] = useState(START_FOLDER)
  // Each machine's home, learnt from the answer to `~`, so paths under it read `~/…` and the path bar starts there.
  const [homes, setHomes] = useState<Readonly<Record<number, string>>>({})
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(-1)
  const [hidden, setHidden] = useState(false)
  const [machineOpen, setMachineOpen] = useState(false)
  const [folders, setFolders] = useState<Read<FolderListing> | null>(null)
  // Bumped when a folder was made, so the folder is read again.
  const [reads, setReads] = useState(0)
  // The new-folder field: null while it is closed, the typed name while it is open.
  const [naming, setNaming] = useState<string | null>(null)
  const [nameShown, setNameShown] = useState(false)
  const [nameWhy, setNameWhy] = useState<string | null>(null)
  const [making, setMaking] = useState(false)
  // The folder just made: selected once the read that lists it arrives.
  const [made, setMade] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const rows = useRef<HTMLDivElement>(null)
  const home = homes[machine] ?? null
  const there = machines.find((candidate) => candidate.machine === machine)
  const label = there?.label ?? 'this machine'
  const asleep = there !== undefined && !there.ready
  const folderKey = `${String(machine)}:${dir}:${String(reads)}`

  useEffect(() => { input.current?.focus() }, [])

  useEffect(() => {
    if (asleep) return undefined
    let live = true
    list(machine, dir).then(
      (value) => {
        if (!live) return
        setFolders({ key: folderKey, result: { state: 'ready', value } })
        if (dir === START_FOLDER && value.exists) setHomes((now) => ({ ...now, [machine]: value.path }))
      },
      (error: unknown) => { if (live) setFolders({ key: folderKey, result: { state: 'failed', why: errorMessage(error, `Could not list ${dir}`) } }) },
    )
    return () => { live = false }
  }, [list, machine, dir, folderKey, asleep])

  const pathQuery = isPathQuery(query)
  const listing = folders?.key === folderKey && folders.result.state === 'ready' ? folders.result.value : null
  const here = listing !== null && listing.exists ? listing.path : null
  const folderFailure = folders?.key === folderKey && folders.result.state === 'failed' ? folders.result.why : null
  const waiting = !asleep && folders?.key !== folderKey
  const loading = useAfterDelay(waiting, folderKey)

  const folderRows = useMemo(() => (listing === null || pathQuery ? [] : visibleFolders(listing.entries, query, hidden)), [listing, pathQuery, query, hidden])
  const count = folderRows.length
  // A folder just made is the one selected, until a key, a click or the filter picks another.
  const madeRow = made === null ? -1 : folderRows.findIndex((entry) => entry.name === made)
  const at = madeRow >= 0 && selected === -1 ? madeRow : Math.min(selected, count - 1)
  const chosenFolder = folderRows[at]
  const target: string | null = here !== null && chosenFolder !== undefined ? joinPath(here, chosenFolder.name) : here
  const cantUse = asleep || waiting || target === null
  const canCreate = listing !== null && listing.exists && listing.can_create
  const olderService = listing !== null && listing.exists && !listing.can_create
  const taken = useMemo(() => listing?.entries.map((entry) => entry.name) ?? [], [listing])
  const nameProblem = naming === null ? null : folderNameProblem(naming, taken)
  const nameError = nameWhy ?? (nameShown ? nameProblem : null)

  const scrollTo = (row: number) => { window.setTimeout(() => { rows.current?.querySelector<HTMLElement>(`[data-row="${String(row)}"]`)?.scrollIntoView({ block: 'nearest' }) }, 0) }
  const stopNaming = () => { setNaming(null); setNameShown(false); setNameWhy(null) }
  const go = (path: string) => { setDir(path); setQuery(''); setSelected(-1); setMade(null); stopNaming() }
  const resolved = (typed: string): string => {
    const text = typed.trim()
    if (text === '~' || text.startsWith('~/')) return home === null ? text : `${home}${text.slice(1)}`
    return text.length > 1 ? text.replace(/[\\/]+$/, '') : text
  }
  const choose = () => { if (!cantUse) onPick({ machine, folder: target }) }
  const pickMachine = (next: number) => {
    setMachine(next)
    setMachineOpen(false)
    setDir(START_FOLDER)
    setQuery('')
    setSelected(-1)
    setFolders(null)
    setMade(null)
    stopNaming()
  }

  const startNaming = () => {
    if (!canCreate || making) return
    if (naming === null) { setNaming(''); setNameShown(false); setNameWhy(null) }
    window.setTimeout(() => { nameInput.current?.focus() }, 0)
  }
  const submitName = async (event: SyntheticEvent) => {
    event.preventDefault()
    if (naming === null || here === null || making) return
    setNameShown(true)
    if (nameProblem !== null) return
    setMaking(true)
    setNameWhy(null)
    try {
      const outcome = await create(machine, here, naming)
      if (outcome.kind === 'created') {
        if (naming.startsWith('.')) setHidden(true)
        setMade(naming)
        setQuery('')
        setSelected(-1)
        stopNaming()
        setReads((now) => now + 1)
        window.setTimeout(() => { input.current?.focus() }, 0)
      } else if (outcome.kind === 'exists') setNameWhy(`A folder called ${naming} is already here.`)
      else setNameWhy(outcome.reason)
    } catch (error: unknown) {
      setNameWhy(errorMessage(error, `Could not make the folder on ${label}`))
    } finally {
      setMaking(false)
    }
  }
  const onNameKeyDown = (event: KeyboardEvent) => {
    // The field has its own keys: nothing it handles reaches the list's.
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      stopNaming()
      input.current?.focus()
    }
  }

  useEffect(() => {
    if (madeRow < 0) return
    window.setTimeout(() => { rows.current?.querySelector<HTMLElement>(`[data-row="${String(madeRow)}"]`)?.scrollIntoView({ block: 'nearest' }) }, 0)
  }, [madeRow])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing || waiting || asleep) return
    const mod = event.ctrlKey || event.metaKey
    if (mod && event.shiftKey && event.key.toLowerCase() === 'n') {
      event.preventDefault()
      startNaming()
      return
    }
    if (event.key === 'Enter' && mod) {
      event.preventDefault()
      choose()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = event.key === 'ArrowDown' ? Math.min(count - 1, at + 1) : Math.max(0, at - 1)
      setSelected(count === 0 ? -1 : next)
      scrollTo(next)
    } else if (event.key === 'Enter' || (event.key === 'ArrowRight' && query === '')) {
      event.preventDefault()
      const chosen = folderRows[at]
      if (pathQuery) go(resolved(query))
      else if (here !== null && chosen !== undefined) go(joinPath(here, chosen.name))
      else if (here !== null && folderRows.length === 1 && folderRows[0] !== undefined) go(joinPath(here, folderRows[0].name))
    } else if ((event.key === 'Backspace' || event.key === 'ArrowLeft') && query === '' && here !== null && !isRoot(here)) {
      event.preventDefault()
      go(parentOf(here))
    }
  }

  const noneText = asleep
    ? `${label} is asleep. Wake it, or pick another machine.`
    : query.trim() !== '' ? `No folder here matches “${query.trim()}”.` : (listing?.entries.length ?? 0) > 0 ? 'Only hidden folders here. Turn on Hidden folders to see them.' : 'No subfolders. Open this one, make a new one, or go up.'
  const crumbs = here === null ? [] : crumbsOf(here, home)
  const showNone = !waiting && !pathQuery && naming === null && (asleep || (listing !== null && listing.exists && folderRows.length === 0))
  const useName = target === null ? null : baseName(target)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent unstyled container={root} overlayClassName="mx-fp-scrim" aria-label="Choose a folder" aria-describedby={undefined} className="mx-fp" onKeyDown={onKeyDown}
        onEscapeKeyDown={(event) => { if (naming !== null) { event.preventDefault(); stopNaming() } else if (query !== '') { event.preventDefault(); setQuery(''); setSelected(-1) } }}
        onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus() }}>
        <DialogTitle className="sr-only">{`Open a folder on ${label}`}</DialogTitle>
        <div className="mx-fp-head">
          <span className="mx-fp-title">Open a folder on</span>
          <Popover.Root open={machineOpen} onOpenChange={setMachineOpen}>
            <Popover.Trigger asChild>
              <button type="button" className="mx-fp-machine" aria-haspopup="listbox" aria-label={`Machine: ${label}`}>
                <span className={`mx-nsd-dot${asleep ? ' is-asleep' : ''}`} aria-hidden="true" />
                <span>{label}</span>
                <Icon name="chevronDown" size={9} />
              </button>
            </Popover.Trigger>
            <PopupContent side="bottom" align="start" sideOffset={4} aria-label="Machine" className="mx-fp-machines">
              <ChoiceList aria-label="Machine" current={String(machine)} className="mx-fp-machine-list">
              {machines.map((candidate) => (
                <ChoiceItem key={candidate.machine} value={String(candidate.machine)} className={`mx-fp-machine-row${candidate.machine === machine ? ' is-selected' : ''}`} onPick={() => { pickMachine(candidate.machine) }}>
                  <span className={`mx-nsd-dot${candidate.ready ? '' : ' is-asleep'}`} aria-hidden="true" />
                  <span className="mx-fp-machine-name">{candidate.label}</span>
                  {candidate.word !== null && <span className={`mx-fp-machine-word${candidate.ready ? '' : ' is-asleep'}`}>{candidate.word}</span>}
                </ChoiceItem>
              ))}
              </ChoiceList>
            </PopupContent>
          </Popover.Root>
          <span className="mx-nsd-grow" />
          <button type="button" className="mx-nsd-close" aria-label="Close" title="Close (Esc)" onClick={onCancel}><Icon name="close" size={13} /></button>
        </div>
        <div className="mx-fp-find">
          <label className="mx-fp-field">
            <Icon name="search" size={13} />
            <input ref={input} aria-label="Find a folder or type a path" value={query} maxLength={MOST_PATH_CHARS} spellCheck={false} placeholder="Filter this folder, or type a path"
              onChange={(event) => { setQuery(event.target.value); setSelected(-1); setMade(null) }} />
          </label>
          <div className="mx-fp-path">
              <button type="button" className="mx-fp-up" aria-label="Up one folder" title="Up one folder (Backspace)" disabled={here === null || isRoot(here)} onClick={() => { if (here !== null) go(parentOf(here)) }}><Icon name="arrowUp" size={13} strokeWidth={2.2} /></button>
              <nav aria-label="Path" className="mx-fp-crumbs">
                {crumbs.map((crumb, place, all) => (
                  <span key={crumb.path} className="mx-fp-crumb-part">
                    {place > 1 || (place === 1 && crumbs[0]?.label !== '/') ? <span className="mx-fp-crumb-sep" aria-hidden="true">/</span> : null}
                    <button type="button" aria-current={place === all.length - 1 ? 'page' : undefined} className="mx-fp-crumb" onClick={() => { go(crumb.path) }}>{crumb.label}</button>
                  </span>
                ))}
              </nav>
              <button type="button" className="mx-fp-new-button" disabled={!canCreate || making} aria-describedby={olderService ? 'mx-fp-older' : undefined} title="New folder (Ctrl+Shift+N)" onClick={startNaming}>
                <Icon name="plus" size={12} strokeWidth={2.2} />
                <span>New folder</span>
              </button>
            </div>
          {olderService && <p id="mx-fp-older" className="mx-fp-note">This machine&apos;s service is older: restart it to create folders.</p>}
        </div>
        <ResultsList ref={rows} aria-label="Folders" className="mx-fp-list">
          {loading && <MLoader label={`Reading ${label}…`} className="mx-fp-loading" />}
          {naming !== null && !waiting && (
            <form className="mx-fp-new" onSubmit={(event) => { void submitName(event) }}>
              <label className="mx-fp-new-row">
                <Icon name="folder" size={14} />
                <input ref={nameInput} aria-label="New folder name" aria-invalid={nameError !== null} aria-describedby={nameError === null ? undefined : 'mx-fp-new-why'} autoFocus value={naming} disabled={making} spellCheck={false} autoComplete="off" maxLength={300} placeholder="New folder name"
                  onChange={(event) => { setNaming(event.target.value); setNameWhy(null) }} onKeyDown={onNameKeyDown} />
                <span className="mx-fp-new-hint" aria-hidden="true">{making ? 'Making…' : '↵ Create · Esc'}</span>
              </label>
              {nameError !== null && <p id="mx-fp-new-why" role="alert" className="mx-fp-new-why">{nameError}</p>}
            </form>
          )}
          {!waiting && (
            <>
              {pathQuery && (
                <button type="button" className="mx-fp-go" onClick={() => { go(resolved(query)) }}><span aria-hidden="true">↵</span><span>{`Go to ${niceOf(resolved(query), home)}`}</span></button>
              )}
              {folderFailure !== null && <p role="alert" className="mx-fp-none">{folderFailure}. You can still type a path above.</p>}
              {listing !== null && !listing.exists && <p role="alert" className="mx-fp-none">{`There is no folder ${listing.path} on ${label}, or it cannot be read.`}</p>}
              {here !== null && !pathQuery && folderRows.map((entry, row) => {
                const on = row === at
                const path = joinPath(here, entry.name)
                return (
                  <ResultsOption key={entry.name} selected={on} data-row={row} title={niceOf(path, home)} className={`mx-fp-row${on ? ' is-selected' : ''}${entry.name.startsWith('.') ? ' is-hidden' : ''}`}
                    onClick={() => { if (on) go(path); else setSelected(row) }}>
                    <Icon name="folder" size={14} />
                    <span className="mx-fp-row-name">{entry.name}</span>
                    {entry.git !== null && <span className="mx-fp-branch"><Icon name="branch" size={11} stroke="currentColor" /><span className="mx-fp-branch-name">{entry.git}</span></span>}
                    <button type="button" className="mx-fp-enter" aria-label={`Open ${entry.name}`} title="Open folder (→)" onClick={(event) => { event.stopPropagation(); go(path) }}><Icon name="chevron" /></button>
                  </ResultsOption>
                )
              })}
              {showNone && <div className="mx-fp-none">{noneText}</div>}
            </>
          )}
        </ResultsList>
        {listing?.truncated === true && <p role="status" className="mx-fp-note">{`Showing the first ${String(listing.entries.length)} folders only.`}</p>}
        <div className="mx-fp-foot">
          <label className="mx-nsd-worktree">
            <Switch aria-label="Hidden folders" checked={hidden} onCheckedChange={setHidden} />
            Hidden folders
          </label>
          <span className="mx-nsd-grow" />
          <button type="button" className="mx-fp-cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="mx-nsd-start mx-fp-use" disabled={cantUse} title={target ?? ''} onClick={choose}>
            <span className="mx-fp-use-label">{useName === null ? 'Open' : `Open ${useName}`}</span><span className="mx-nsd-start-key">↵</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
