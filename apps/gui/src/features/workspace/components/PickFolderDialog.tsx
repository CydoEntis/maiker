import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Popover } from 'radix-ui'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { MLoader } from '@/components/ui/m-loader'
import { ChoiceItem, ChoiceList } from '@/components/ui/choice-list'
import { PopupContent } from '@/components/ui/popup'
import { ResultsList, ResultsOption } from '@/components/ui/results-list'
import { Switch } from '@/components/ui/switch'
import type { FolderListing } from '@/api/folders'
import { errorMessage } from '@/lib/error-message'
import { nowSeconds } from '../model/newChatHost'
import { agoOf, baseName, crumbsOf, groupRepositories, isPathQuery, isRoot, joinPath, niceOf, parentOf, visibleFolders, type PickedFolder, type Repository, type RepositoryIndex, type RepositorySource } from '../model/folderPick'
import { Icon } from './glyphs'
import { DAEMON_NAME } from '@/brand'

/** Longest path the host accepts. */
const MOST_PATH_CHARS = 4096

/** Where browsing a machine starts: its home folder. */
const START_FOLDER = '~'

/** A read shorter than this shows no loader: a flash of the M for a local read is noise. */
const LOADER_DELAY_MS = 160

type Tab = 'repos' | 'browse'

/** A machine the picker can read: `word` says why it cannot be, when it cannot. */
export type PickerMachine = { machine: number; label: string; ready: boolean; word: string | null }

type Read<Value> = { key: string; result: { state: 'ready'; value: Value } | { state: 'failed'; why: string } }

type Props = {
  machines: readonly PickerMachine[]
  /** The machine the picker opens on. */
  machine: number
  list: (machine: number, path: string) => Promise<FolderListing>
  /** The daemon's repository index; null when this build has no way to ask for it. */
  repositories: RepositorySource | null
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
 * Open a folder on a machine. The machine is a list in the title; Repositories (the repositories the machine's daemon has
 * indexed, those used from here first) and Browse (folder by folder) are its two tabs; one input filters the rows, or
 * jumps when it starts with `/` or `~`. Up and Down select, Enter opens a repository or goes into a folder, Right goes
 * into a folder, Backspace goes up, Tab switches tab, Ctrl+Enter chooses, Esc clears the input and then closes.
 * Every name shown came from the machine's daemon.
 */
export function PickFolderDialog({ machines, machine: first, list, repositories, onPick, onCancel }: Props) {
  const [machine, setMachine] = useState(first)
  // The window's root, where the theme's variables live; read once, so the dialog's portal never moves.
  const [root] = useState(() => window.document.querySelector<HTMLElement>('.mx-app'))
  const [tab, setTab] = useState<Tab>(repositories === null ? 'browse' : 'repos')
  const [dir, setDir] = useState(START_FOLDER)
  // Each machine's home, learnt from the answer to `~`, so paths under it read `~/…` and the path bar starts there.
  const [homes, setHomes] = useState<Readonly<Record<number, string>>>({})
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(-1)
  const [hidden, setHidden] = useState(false)
  const [machineOpen, setMachineOpen] = useState(false)
  const [folders, setFolders] = useState<Read<FolderListing> | null>(null)
  const [index, setIndex] = useState<Read<RepositoryIndex> | null>(null)
  const [rescans, setRescans] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const rows = useRef<HTMLDivElement>(null)
  const home = homes[machine] ?? null
  const there = machines.find((candidate) => candidate.machine === machine)
  const label = there?.label ?? 'this machine'
  const asleep = there !== undefined && !there.ready
  const folderKey = `${String(machine)}:${dir}`
  const repoKey = `${String(machine)}:${String(rescans)}`

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

  useEffect(() => {
    if (repositories === null || asleep) return undefined
    let live = true
    // A rescan asks the daemon to look again; the first read and a machine switch read what it already knows.
    const ask = rescans === 0 ? repositories.list(machine) : repositories.rescan(machine)
    ask.then(
      (value) => { if (live) setIndex({ key: repoKey, result: { state: 'ready', value } }) },
      (error: unknown) => { if (live) setIndex({ key: repoKey, result: { state: 'failed', why: errorMessage(error, `Could not read the repositories on ${label}`) } }) },
    )
    return () => { live = false }
  }, [repositories, machine, rescans, repoKey, asleep, label])

  const isRepos = tab === 'repos'
  const pathQuery = isPathQuery(query)
  const listing = folders?.key === folderKey && folders.result.state === 'ready' ? folders.result.value : null
  const here = listing !== null && listing.exists ? listing.path : null
  const folderFailure = folders?.key === folderKey && folders.result.state === 'failed' ? folders.result.why : null
  const indexRead = index?.key === repoKey ? index.result : null
  const indexed = indexRead?.state === 'ready' ? indexRead.value : null
  const waiting = !asleep && (isRepos ? repositories !== null && indexRead === null : folders?.key !== folderKey)
  const loading = useAfterDelay(waiting, `${tab}:${folderKey}:${repoKey}`)

  const groups = useMemo(() => (indexed === null || pathQuery ? { recent: [], rest: [] } : groupRepositories(indexed.repos, query)), [indexed, pathQuery, query])
  const flat = useMemo<Repository[]>(() => [...groups.recent, ...groups.rest], [groups])
  const folderRows = useMemo(() => (listing === null || pathQuery ? [] : visibleFolders(listing.entries, query, hidden)), [listing, pathQuery, query, hidden])
  const count = isRepos ? flat.length : folderRows.length
  const at = Math.min(selected, count - 1)
  const chosenFolder = folderRows[at]
  const target: string | null = isRepos ? flat[Math.max(at, 0)]?.path ?? null : here !== null && chosenFolder !== undefined ? joinPath(here, chosenFolder.name) : here
  const cantUse = asleep || waiting || target === null

  const scrollTo = (row: number) => { window.setTimeout(() => { rows.current?.querySelector<HTMLElement>(`[data-row="${String(row)}"]`)?.scrollIntoView({ block: 'nearest' }) }, 0) }
  const go = (path: string) => { setDir(path); setQuery(''); setSelected(-1); setTab('browse') }
  const resolved = (typed: string): string => {
    const text = typed.trim()
    if (text === '~' || text.startsWith('~/')) return home === null ? text : `${home}${text.slice(1)}`
    return text.length > 1 ? text.replace(/[\\/]+$/, '') : text
  }
  const choose = () => { if (!cantUse) onPick({ machine, folder: target }) }
  const pickTab = (next: Tab) => { setTab(next); setSelected(-1); if (!isPathQuery(query)) setQuery('') }
  const pickMachine = (next: number) => {
    setMachine(next)
    setMachineOpen(false)
    setDir(START_FOLDER)
    setQuery('')
    setSelected(-1)
    setFolders(null)
    setIndex(null)
    setRescans(0)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing || waiting || asleep) return
    const mod = event.ctrlKey || event.metaKey
    const typing = event.target === input.current
    if (event.key === 'Enter' && (mod || (isRepos && !pathQuery))) {
      event.preventDefault()
      choose()
    } else if (event.key === 'Tab' && !event.shiftKey && typing) {
      event.preventDefault()
      pickTab(isRepos ? 'browse' : 'repos')
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = event.key === 'ArrowDown' ? Math.min(count - 1, at + 1) : Math.max(0, at - 1)
      setSelected(count === 0 ? -1 : next)
      scrollTo(next)
    } else if (event.key === 'Enter' || (event.key === 'ArrowRight' && query === '' && !isRepos)) {
      event.preventDefault()
      const chosen = folderRows[at]
      if (pathQuery) go(resolved(query))
      else if (here !== null && chosen !== undefined) go(joinPath(here, chosen.name))
      else if (here !== null && folderRows.length === 1 && folderRows[0] !== undefined) go(joinPath(here, folderRows[0].name))
    } else if ((event.key === 'Backspace' || event.key === 'ArrowLeft') && query === '' && !isRepos && here !== null && !isRoot(here)) {
      event.preventDefault()
      go(parentOf(here))
    }
  }

  const noneText = asleep
    ? `${label} is asleep. Wake it, or pick another machine.`
    : isRepos
      ? query.trim() !== '' ? `No repository matches “${query.trim()}”. Try Browse, or type a path starting with / or ~.` : `No repositories found on ${label} yet. Try Browse.`
      : query.trim() !== '' ? `No folder here matches “${query.trim()}”.` : (listing?.entries.length ?? 0) > 0 ? 'Only hidden folders here. Turn on Hidden folders to see them.' : 'No subfolders. Open this one, or go up.'
  const now = nowSeconds()
  const crumbs = here === null ? [] : crumbsOf(here, home)
  const showNone = !waiting && !pathQuery && (asleep || (isRepos ? (repositories !== null && indexed !== null && flat.length === 0) : (listing !== null && listing.exists && folderRows.length === 0)))
  const useName = target === null ? null : baseName(target)
  const repoRow = (repo: Repository, row: number) => {
    const on = row === at
    return (
      <ResultsOption key={repo.path} selected={on} data-row={row} title={niceOf(repo.path, home)} className={`mx-fp-row is-repo${on ? ' is-selected' : ''}`}
        onClick={() => { if (on) choose(); else setSelected(row) }} onDoubleClick={choose}>
        <Icon name="folder" size={14} />
        <span className="mx-fp-row-text">
          <span className="mx-fp-row-name">{baseName(repo.path)}</span>
          <span className="mx-fp-row-sub">{`${niceOf(parentOf(repo.path), home)}/`}</span>
        </span>
        <span className="mx-fp-row-side">
          {repo.branch !== null && <span className="mx-fp-branch"><Icon name="branch" size={11} stroke="currentColor" />{repo.branch}</span>}
          {repo.lastUsed !== null && <span className="mx-fp-when">{`Used ${agoOf(repo.lastUsed, now)}`}</span>}
        </span>
      </ResultsOption>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent unstyled container={root} overlayClassName="mx-fp-scrim" aria-label="Choose a folder" aria-describedby={undefined} className="mx-fp" onKeyDown={onKeyDown}
        onEscapeKeyDown={(event) => { if (query !== '') { event.preventDefault(); setQuery(''); setSelected(-1) } }}
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
        <div role="tablist" aria-label="How to find it" className="mx-fp-tabs">
          {repositories !== null && (
            <button type="button" role="tab" aria-selected={isRepos} className="mx-fp-tab" onClick={() => { pickTab('repos') }}>Repositories{indexed !== null && <span>{indexed.repos.length}</span>}</button>
          )}
          <button type="button" role="tab" aria-selected={!isRepos} className="mx-fp-tab" onClick={() => { pickTab('browse') }}>Browse</button>
        </div>
        <div className="mx-fp-find">
          <label className="mx-fp-field">
            <Icon name="search" size={13} />
            <input ref={input} aria-label="Find a folder or type a path" value={query} maxLength={MOST_PATH_CHARS} spellCheck={false} placeholder={isRepos ? 'Find a repository, or type a path' : 'Filter this folder, or type a path'}
              onChange={(event) => { setQuery(event.target.value); setSelected(-1) }} />
          </label>
          {!isRepos && (
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
            </div>
          )}
        </div>
        <ResultsList ref={rows} aria-label="Folders" className="mx-fp-list">
          {loading && <MLoader label={`Reading ${label}…`} className="mx-fp-loading" />}
          {!waiting && (
            <>
              {pathQuery && (
                <button type="button" className="mx-fp-go" onClick={() => { go(resolved(query)) }}><span aria-hidden="true">↵</span><span>{`Go to ${niceOf(resolved(query), home)}`}</span></button>
              )}
              {isRepos && !pathQuery && repositories !== null && indexRead?.state === 'failed' && <p role="alert" className="mx-fp-none">{indexRead.why}</p>}
              {isRepos && !pathQuery && (
                <>
                  {groups.recent.length > 0 && <div className="mx-fp-group">{`Recent on ${label}`}</div>}
                  {groups.recent.map((repo, row) => repoRow(repo, row))}
                  {groups.rest.length > 0 && <div className="mx-fp-group">{groups.recent.length > 0 ? 'Other repositories' : 'Repositories'}</div>}
                  {groups.rest.map((repo, row) => repoRow(repo, groups.recent.length + row))}
                </>
              )}
              {!isRepos && folderFailure !== null && <p role="alert" className="mx-fp-none">{folderFailure}. You can still type a path above.</p>}
              {!isRepos && listing !== null && !listing.exists && <p role="alert" className="mx-fp-none">{`There is no folder ${listing.path} on ${label}, or it cannot be read.`}</p>}
              {!isRepos && here !== null && !pathQuery && folderRows.map((entry, row) => {
                const on = row === at
                const path = joinPath(here, entry.name)
                return (
                  <ResultsOption key={entry.name} selected={on} data-row={row} title={niceOf(path, home)} className={`mx-fp-row${on ? ' is-selected' : ''}${entry.name.startsWith('.') ? ' is-hidden' : ''}`}
                    onClick={() => { if (on) go(path); else setSelected(row) }}>
                    <Icon name="folder" size={14} />
                    <span className="mx-fp-row-name">{entry.name}</span>
                    {entry.git !== null && <span className="mx-fp-branch"><Icon name="branch" size={11} stroke="currentColor" />{entry.git}</span>}
                    <button type="button" className="mx-fp-enter" aria-label={`Open ${entry.name}`} title="Open folder (→)" onClick={(event) => { event.stopPropagation(); go(path) }}><Icon name="chevron" /></button>
                  </ResultsOption>
                )
              })}
              {showNone && <div className="mx-fp-none">{noneText}</div>}
            </>
          )}
        </ResultsList>
        {!isRepos && listing?.truncated === true && <p role="status" className="mx-fp-note">{`Showing the first ${String(listing.entries.length)} folders only.`}</p>}
        <div className="mx-fp-foot">
          {!isRepos && (
            <label className="mx-nsd-worktree">
              <Switch aria-label="Hidden folders" checked={hidden} onCheckedChange={setHidden} />
              Hidden folders
            </label>
          )}
          {isRepos && (
            <>
              <span className="mx-fp-index">{indexed === null || indexed.indexedAt === null ? `Indexed by ${DAEMON_NAME}` : `Indexed by ${DAEMON_NAME} · ${agoOf(indexed.indexedAt, now)}`}</span>
              <button type="button" className="mx-fp-link" disabled={asleep || waiting} onClick={() => { setIndex(null); setRescans((count) => count + 1) }}>Rescan</button>
            </>
          )}
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
