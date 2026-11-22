import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ChatEvent, ItemStatus, TurnEvent } from '@/features/chat/chatEvents'
import { buildRows, type ChatRow } from '@/features/chat/chatRows'
import { commandEvent, messageEvent, reasoningEvent, toolEvent } from '@/features/chat/eventFixtures'
import { ChatItem, type ChatItemContext } from '@/features/chat/components/ChatItems'
import { VirtualList } from '@/features/chat/components/VirtualList'

/*
 * A made-up turn replayed one read at a time, so the live chat (rows drawn as they arrive, the reply growing in place, the
 * working line at the end, the list following the newest row) can be checked on screen without an agent running.
 */

/** How long the gallery's turn says it has worked, and how long it took in the end. */
const WORKED_MS = 12_000
const TOOK_MS = 41_000
const INSTALL_MS = 2_400
/** When the turn started, fixed at load so a render stays pure. */
const WORKING_SINCE = Date.now() - WORKED_MS
/** How far apart Play shows the reads, about as often as an open chat reads a working agent. */
const READ_MS = 300
const LIST_HEIGHT_PX = 460
const ESTIMATED_ROW_PX = 72
/** How many reads bring each part of the reply, an even share more each time. */
const FIRST_READS = 4
const SECOND_READS = 3
const shares = (reads: number) => Array.from({ length: reads }, (_, index) => (index + 1) / reads)

const running = (status: ItemStatus) => ({ status, observed: { firstSeenAtMs: WORKING_SINCE, settledAtMs: status === 'running' ? null : WORKING_SINCE } })
const reply = (id: string, text: string, status: ItemStatus = 'running') => ({ ...messageEvent(id, 'agent', text), ...running(status) })
const read = (id: string, target: string, status: ItemStatus = 'completed') => ({ ...toolEvent(id, { target }), ...running(status) })

const ASKED = messageEvent('u1', 'user', 'The build fails on CI but not here. Find out why and fix it.')
const THOUGHT = reasoningEvent('r1', 'CI and local differ: the install, the Node version or an env var.')
const WORKFLOW = '.github/workflows/ci.yml'
const FIRST = 'I found it. CI installs with a frozen lockfile, and `pnpm-lock.yaml` still pins `vite@5.4.0` while `package.json` asks for `^5.4.2`.'
const SECOND = 'Locally the install quietly updates the lockfile, so it works.\n\nThe fix:\n\n- regenerate the lockfile\n- add a check so a stale lockfile fails here too'
const INSTALL = 'pnpm install --lockfile-only'
const DONE: TurnEvent = { kind: 'turn', id: 'turn:t1', turnId: 't1', outcome: 'completed', startedAtMs: WORKING_SINCE, endedAtMs: WORKING_SINCE + TOOK_MS, timed: true }
/** The turn once its three reads have finished, before it says anything. */
const LOOKED = [ASKED, THOUGHT, read('s1', WORKFLOW), read('s2', 'package.json'), read('s3', 'pnpm-lock.yaml')]
const ANSWER = `${FIRST}\n\n${SECOND}`

/** Cuts a text to its first `share` (0 to 1), as a reply looks part-way through arriving. */
const part = (text: string, share: number) => text.slice(0, Math.round(text.length * share))

/** Each read of the turn: what the history held then. The last has the turn ended. */
const READS: readonly (readonly ChatEvent[])[] = [
  [ASKED],
  [ASKED, THOUGHT],
  [ASKED, THOUGHT, read('s1', WORKFLOW, 'running')],
  [ASKED, THOUGHT, read('s1', WORKFLOW), read('s2', 'package.json', 'running')],
  LOOKED,
  ...shares(FIRST_READS).map((share) => [...LOOKED, reply('a1', part(FIRST, share))]),
  ...shares(SECOND_READS).map((share) => [...LOOKED, reply('a1', `${FIRST}\n\n${part(SECOND, share)}`)]),
  [...LOOKED, reply('a1', ANSWER, 'completed'), { ...commandEvent('c1', { command: INSTALL }), ...running('running') }],
  [...LOOKED, reply('a1', ANSWER, 'completed'), commandEvent('c1', { command: INSTALL, output: 'Lockfile is up to date', exitCode: 0, durationMs: INSTALL_MS }), reply('a2', 'Regenerated. The build passes with a frozen lockfile now.', 'completed'), DONE],
]
const LAST = READS.length - 1

const CONTEXT: ChatItemContext = { agent: 'claude', workingSince: WORKING_SINCE, root: null, openDiff: null, goToStep: null, waitingStep: null }
const rowKey = (row: ChatRow) => row.key

/** The turn at one read, in the real list, with buttons to step through the reads or play them at the chat's pace. */
export function LiveTurnGallery({ width }: { width: number }) {
  const [at, setAt] = useState(0)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!playing) return undefined
    const timer = window.setInterval(() => { setAt((now) => Math.min(LAST, now + 1)) }, READ_MS)
    return () => { window.clearInterval(timer) }
  }, [playing])
  if (playing && at === LAST) setPlaying(false)
  const rows = useMemo(() => buildRows(READS[at] ?? [], at < LAST), [at])
  const renderRow = useCallback((row: ChatRow) => <ChatItem row={row} {...CONTEXT} />, [])
  return (
    <div className="flex flex-col gap-2" style={{ width }} data-live-turn={width}>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="soft" onClick={() => { setPlaying(false); setAt((now) => Math.max(0, now - 1)) }}>Back</Button>
        <Button size="sm" variant="soft" data-live-next="" onClick={() => { setPlaying(false); setAt((now) => Math.min(LAST, now + 1)) }}>Next</Button>
        <Button size="sm" variant="soft" onClick={() => { setAt(0); setPlaying(true) }}>Play</Button>
        <span className="text-xs text-(--muted)">Read {at + 1} of {LAST + 1}</span>
      </div>
      <div className="mx-chat flex flex-col border border-(--line)" style={{ flex: 'none', height: LIST_HEIGHT_PX, zoom: 1 }}>
        <VirtualList items={rows} getKey={rowKey} estimate={ESTIMATED_ROW_PX} renderItem={renderRow} label={`A turn as it streams, ${String(width)}px`} />
      </div>
    </div>
  )
}
