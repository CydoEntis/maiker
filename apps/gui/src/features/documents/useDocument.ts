import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { LOCAL_MACHINE } from '@/api/machines'
import { messageOf } from '@/features/inspect/useRepoQuery'
import { OLDER_SERVICE_WORDS, repoFile, repoFileStamped, saveProjectFile, type SaveResult } from '@/features/inspect/api'
import type { SaveStep } from './documentEdit'

/** How a document is read and saved. The real one asks the daemon; a test or the gallery gives its own. */
export type DocumentIO = {
  /** The text and its version; a null version is a daemon that cannot save with a version check, an empty one a text that was changed to be shown safely (no editing either way). */
  read: (term: number, machine: number, path: string) => Promise<{ text: string; version: string | null }>
  save: (term: number, machine: number, path: string, contents: string, version: string | null) => Promise<SaveResult>
}

export const daemonDocumentIO: DocumentIO = {
  async read(term, machine, path) {
    try {
      return await repoFileStamped(term, path, machine)
    } catch (error) {
      // A service from before editing cannot answer the stamped read: the file is still shown, only not editable.
      // Another machine's service is never older than this app (the window turns it away when it connects).
      if (machine !== LOCAL_MACHINE || !messageOf(error).includes(OLDER_SERVICE_WORDS)) throw error
      return { text: await repoFile(term, path), version: null }
    }
  },
  save: saveProjectFile,
}

type Disk = { text: string; version: string | null }

export type DocumentState = {
  phase: 'loading' | 'ready' | 'error'
  /** What the file says on disk, as last read or saved. */
  text: string
  error: string | null
  /** Whether this file can be edited and saved: its daemon checks versions and its text is the file's own. */
  canEdit: boolean
  /** Why it cannot, when it is shown anyway: its service is older than this app, or its text had to be changed to be shown safely. */
  readOnlyBecause: 'older' | 'unsafe' | null
  /** A newer text on disk than the one shown, while a draft is open: the person chooses. */
  behind: Disk | null
  step: SaveStep
  reload: () => void
  /** Takes the newer text on disk as the one shown. */
  adoptBehind: () => void
  /** Writes `contents`; `overwrite` is only ever the person's answer to a conflict. */
  save: (contents: string, overwrite: boolean) => Promise<boolean>
  /** Clears a failed or conflicting save, e.g. after the person edited again. */
  settle: () => void
}

/**
 * One file of a pane's checkout: read once, read again when the window gets the focus (the app watches no files, so
 * that is when an agent's edit is noticed), and saved with the version it was read at. A newer text on disk replaces
 * the shown one at once when no draft is open, and waits as `behind` when one is.
 */
export function useDocument({ term, machine, path, dirtyRef, io = daemonDocumentIO }: { term: number; machine: number; path: string; /** Whether a draft is open that a newer text on disk would replace; read when the window regains focus. */ dirtyRef: RefObject<boolean>; io?: DocumentIO }): DocumentState {
  const [round, setRound] = useState(0)
  // What was read for the file this hook is on now. A result for another file or an earlier read is not shown: the key tells.
  const readKey = `${String(machine)}\u0000${String(term)}\u0000${path}\u0000${String(round)}`
  const [read, setRead] = useState<{ key: string; disk: Disk | null; error: string | null; behind: Disk | null; step: SaveStep }>({ key: '', disk: null, error: null, behind: null, step: { kind: 'idle' } })
  const fresh = read.key === readKey
  const disk = fresh ? read.disk : null
  const error = fresh ? read.error : null
  const behind = fresh ? read.behind : null
  const step: SaveStep = fresh ? read.step : { kind: 'idle' }
  const diskRef = useRef<Disk | null>(null)
  const keyRef = useRef(readKey)
  const patch = useCallback((change: Partial<{ disk: Disk | null; error: string | null; behind: Disk | null; step: SaveStep }>) => {
    setRead((before) => (before.key === keyRef.current ? { ...before, ...change } : before))
  }, [])
  const shown = useCallback((next: Disk) => { diskRef.current = next; patch({ disk: next, behind: null }) }, [patch])

  useEffect(() => {
    let current = true
    keyRef.current = readKey
    diskRef.current = null
    io.read(term, machine, path).then(
      (next) => { if (current) { diskRef.current = next; setRead({ key: readKey, disk: next, error: null, behind: null, step: { kind: 'idle' } }) } },
      (reason: unknown) => { if (current) setRead({ key: readKey, disk: null, error: messageOf(reason), behind: null, step: { kind: 'idle' } }) },
    )
    return () => { current = false }
  }, [io, term, machine, path, readKey])

  useEffect(() => {
    let current = true
    const recheck = () => {
      if (diskRef.current === null) return
      io.read(term, machine, path).then((next) => {
        if (!current || diskRef.current === null || next.version === diskRef.current.version && next.text === diskRef.current.text) return
        if (dirtyRef.current) patch({ behind: next })
        else shown(next)
      }, () => undefined)
    }
    window.addEventListener('focus', recheck)
    return () => { current = false; window.removeEventListener('focus', recheck) }
  }, [io, term, machine, path, shown, patch, dirtyRef])

  const save = useCallback(async (contents: string, overwrite: boolean): Promise<boolean> => {
    const base = diskRef.current
    if (base === null) return false
    patch({ step: { kind: 'saving' } })
    try {
      const result = await io.save(term, machine, path, contents, overwrite ? null : base.version)
      if (result.kind === 'changed') { patch({ step: { kind: 'changed' } }); return false }
      shown({ text: contents, version: result.version })
      patch({ step: { kind: 'idle' } })
      return true
    } catch (reason) {
      patch({ step: { kind: 'failed', message: messageOf(reason) } })
      return false
    }
  }, [io, term, machine, path, shown, patch])

  return {
    phase: error !== null ? 'error' : disk === null ? 'loading' : 'ready',
    text: disk?.text ?? '',
    error,
    canEdit: disk?.version != null && disk.version !== '',
    readOnlyBecause: disk === null ? null : disk.version === null ? 'older' : disk.version === '' ? 'unsafe' : null,
    behind,
    step,
    reload: useCallback(() => { setRound((n) => n + 1) }, []),
    adoptBehind: useCallback(() => { setRead((before) => { if (before.behind !== null) diskRef.current = before.behind; return before.behind === null ? before : { ...before, disk: before.behind, behind: null } }) }, []),
    save,
    settle: useCallback(() => { patch({ step: { kind: 'idle' } }) }, [patch]),
  }
}
