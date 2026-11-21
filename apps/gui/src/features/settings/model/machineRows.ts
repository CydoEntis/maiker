import { machineTitle, type MachineHead } from '@/features/workspace/model/machines'

/** ssh's wording when it stops on the host key: with it, the login problem is the key, not the password. */
export const HOST_KEY_WORDS = /Host key verification failed/i

/** The list shows its search field only past this many machines. */
export const SEARCH_AFTER = 12
/** "Update all" appears once this many machines run an older Maiker. */
export const UPDATE_ALL_FROM = 2

/** `●` connected, `○` waiting or asleep, `!` needs you, `×` failed. Colour only ever says status. */
export type Glyph = '●' | '○' | '!' | '×'
export type Tone = 'ok' | 'quiet' | 'needs' | 'bad'

/** What a row's one button does: Fix opens the row's More fold, the others run in place. */
export type RowAction = 'fix' | 'retry' | 'update' | 'install'

export type MachineRow = {
  glyph: Glyph
  tone: Tone
  /** The one thing that matters about the machine now. */
  line: string
  /** The line ends in how long the machine has been down. */
  showsSince: boolean
  action: RowAction | null
  /** Where the row sorts: failed first, then machines to update, then connecting, then just added, then connected. */
  rank: number
}

const RANK_FAILED = 0
const RANK_UPDATE = 1
const RANK_CONNECTING = 2
const RANK_CONNECTED = 3

function countWords(count: number): string {
  return `${String(count)} ${count === 1 ? 'session' : 'sessions'}`
}

/** How a row says how many sessions a healthy machine has. */
export function sessionWords(count: number): string {
  return count === 0 ? 'No sessions' : countWords(count)
}

/** Whether the machine stopped on its host key rather than on a key it was refused. */
export function stoppedOnHostKey(head: MachineHead): boolean {
  return HOST_KEY_WORDS.test(head.said ?? '')
}

/**
 * The one line and one fix of a machine's row, in the first match of: login, can't reach, fix for the
 * app there, connecting, healthy. `sessions` is null when the sidebar has not counted it.
 */
export function rowOf(head: MachineHead, sessions: number | null): MachineRow {
  const word = head.chip?.word
  const count = sessions === null ? null : sessionWords(sessions)
  if (word === 'needs login') {
    return { glyph: '×', tone: 'bad', line: stoppedOnHostKey(head) ? 'Host key not trusted' : 'Key rejected', showsSince: false, action: 'fix', rank: RANK_FAILED }
  }
  if (word === 'unreachable' || word === 'refused') {
    return { glyph: '×', tone: 'bad', line: word === 'refused' ? 'Refused the connection' : "Can't reach it", showsSince: head.downSince !== null, action: 'retry', rank: RANK_FAILED }
  }
  if (head.updateAction === 'install') {
    return { glyph: '!', tone: 'needs', line: 'Maiker not installed', showsSince: false, action: 'install', rank: RANK_UPDATE }
  }
  if (head.updateAction === 'update') {
    // The machine is connected and its sessions run; only the update is waiting, so it reads as a live machine with a button.
    return { glyph: '●', tone: 'ok', line: count === null ? 'Older Maiker' : `${count} · older Maiker`, showsSince: false, action: 'update', rank: RANK_UPDATE }
  }
  if (word === 'newer than this app') {
    return { glyph: '!', tone: 'needs', line: count === null ? 'Newer Maiker' : `${count} · newer Maiker`, showsSince: false, action: null, rank: RANK_UPDATE }
  }
  if (head.chip === null || head.chip.tone === 'quiet') {
    return { glyph: '○', tone: 'quiet', line: head.chip === null ? 'Connecting…' : `${capitalised(head.chip.word)}…`, showsSince: false, action: null, rank: RANK_CONNECTING }
  }
  return { glyph: '●', tone: 'ok', line: count ?? 'Connected', showsSince: false, action: null, rank: RANK_CONNECTED }
}

function capitalised(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** The name a machine goes by in the list: the one you gave it, else its own. */
export function nameOf(head: MachineHead): string {
  return machineTitle(head)
}

/**
 * Anything that needs a person is at the top without a filter: failed, then a machine to update, then
 * connecting, then connected, busiest first. Ties keep the alphabet.
 */
export function ordered(heads: readonly MachineHead[], sessionsOf: (head: MachineHead) => number | null): MachineHead[] {
  const keyed = heads.map((head) => {
    const sessions = sessionsOf(head)
    return { head, rank: rowOf(head, sessions).rank, sessions: sessions ?? 0 }
  })
  return keyed
    .sort((a, b) => a.rank - b.rank || b.sessions - a.sessions || nameOf(a.head).localeCompare(nameOf(b.head), undefined, { sensitivity: 'base' }))
    .map(({ head }) => head)
}

/** The machines whose name or address contains what was typed, in any case. */
export function matching(heads: readonly MachineHead[], typed: string): MachineHead[] {
  const text = typed.trim().toLowerCase()
  if (text === '') return [...heads]
  return heads.filter((head) => `${nameOf(head)} ${head.label} ${head.target ?? ''}`.toLowerCase().includes(text))
}

/** The machines a single "Update all" would update: those whose app is older, never a first install. */
export function updatable(heads: readonly MachineHead[]): MachineHead[] {
  return heads.filter((head) => head.updateAction === 'update')
}

export type FoldStatus = {
  glyph: Glyph
  tone: Tone
  /** The sentence in the text colour. */
  lead: string
  /** The sentence after it, in the second colour. */
  more: string | null
  /** The lead is followed by " for 14 min.": the fold adds it, so the time stays live. */
  showsSince: boolean
  /** A command to run once in a terminal, with a Copy button. */
  command: string | null
  action: 'retry' | null
}

/** What a machine's More fold says at the top, from the same state as its row. */
export function foldStatusOf(head: MachineHead, sessions: number | null): FoldStatus {
  const word = head.chip?.word
  if (word === 'needs login') {
    const command = head.target === null ? null : `ssh-copy-id ${head.target}`
    return { glyph: '×', tone: 'bad', lead: 'Key rejected.', more: 'Run this once on this computer, then try again.', showsSince: false, command, action: 'retry' }
  }
  if (word === 'unreachable' || word === 'refused') {
    const lead = word === 'refused' ? 'Refused the connection' : "Can't reach it"
    const since = head.downSince !== null
    return { glyph: '×', tone: 'bad', lead: since ? lead : `${lead}.`, more: head.why, showsSince: since, command: null, action: 'retry' }
  }
  if (word === 'connected') {
    return { glyph: '●', tone: 'ok', lead: sessions === null ? 'Connected' : `Connected · ${countWords(sessions)}`, more: null, showsSince: false, command: null, action: null }
  }
  if (head.updateAction !== null || word === 'newer than this app') {
    return { glyph: '!', tone: 'needs', lead: head.updateAction === 'install' ? 'Maiker is not installed.' : head.updateAction === 'update' ? 'It runs an older Maiker.' : 'It runs a newer Maiker than this computer.', more: null, showsSince: false, command: null, action: null }
  }
  return { glyph: '○', tone: 'quiet', lead: head.chip === null ? 'Connecting…' : `${capitalised(head.chip.word)}…`, more: null, showsSince: false, command: null, action: null }
}

/** What the fold's Maiker row says of the app on the machine. */
export function maikerLine(head: MachineHead, thisVersion: string | null): string {
  if (head.updateAction === 'install') return 'Not installed'
  if (head.updateAction === 'update') return thisVersion === null ? "Older than this computer's" : `Older · this computer has ${thisVersion}`
  if (head.chip?.word === 'newer than this app') return 'Newer than this app'
  return head.chip?.word === 'connected' ? 'Up to date' : 'Unknown until it connects'
}
