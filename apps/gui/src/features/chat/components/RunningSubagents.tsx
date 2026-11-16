import { useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { StatusMark } from '@/components/ui/status-mark'
import { Icon, Spinner } from '@/features/workspace/components/glyphs'
import { runningSubagents, subagentWord, type SubagentView } from '@/features/workspace/model/subagents'

const SECOND_MS = 1000

/** Now in unix seconds, ticking once a second while there is a running time to count. */
function useNowSeconds(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / SECOND_MS))
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Math.floor(Date.now() / SECOND_MS)) }, SECOND_MS)
    return () => { window.clearInterval(timer) }
  }, [])
  return now
}

function Mark({ subagent }: { subagent: SubagentView }) {
  return <StatusMark state={subagent.status === 'needs' ? 'needs' : 'running'} spinner={<Spinner />} />
}

/** One running subagent: its task and what it is doing; a click unfolds what it was asked and what it reported. */
function SubagentRow({ subagent, now, onOpen }: { subagent: SubagentView; now: number; onOpen: ((id: string) => void) | null }) {
  const [open, setOpen] = useState(false)
  const detail = useId()
  return (
    <li className="mx-subs-item">
      <button type="button" className="mx-subs-row" aria-expanded={open} aria-controls={detail} onClick={() => { setOpen(!open) }}>
        <Mark subagent={subagent} />
        <span className="mx-subs-text">
          <span className="mx-subs-name">{subagent.name}<span className="mx-subs-kind">{subagent.kind}</span></span>
          <span className="mx-subs-latest">{subagent.status === 'needs' ? 'Waiting for an answer in the terminal' : subagent.latest ?? 'Working'}</span>
        </span>
        <span className="mx-subs-time">{subagentWord(subagent, now)}</span>
      </button>
      {open && (
        <div id={detail} className="mx-subs-detail">
          <span className="mx-subs-label">Asked to</span>
          <p>{subagent.task ?? 'The runtime did not report its task.'}</p>
          {subagent.latest !== null && <><span className="mx-subs-label">Ran</span><p className="is-mono">{subagent.latest}</p></>}
          {onOpen !== null && <div><Button variant="soft" size="sm" onClick={() => { onOpen(subagent.id) }}>Open its chat</Button></div>}
        </div>
      )}
    </li>
  )
}

type Props = {
  subagents: readonly SubagentView[]
  /** Opens a subagent's own chat in the pane; absent where the pane cannot show it. */
  onOpen: ((id: string) => void) | null
  /** Starts with the list shown, as the gallery draws it. */
  startOpen?: boolean
}

/**
 * The subagents an agent has running, in a bar floating under the pane's header (`RunningSubagents`), over the chat or
 * the terminal alike. It shows only while one runs: how many, the first one's task and what it is doing. A click on the
 * bar opens the list downward over the feed without moving the bar. A subagent that finishes clears itself, and the bar goes with
 * the last one.
 */
export function RunningSubagents({ subagents, onOpen, startOpen = false }: Props) {
  const running = runningSubagents(subagents)
  const [open, setOpen] = useState(startOpen)
  const list = useId()
  const now = useNowSeconds()
  const first = running[0]
  if (first === undefined) return null
  const more = running.length - 1
  const count = `${String(running.length)} ${running.length === 1 ? 'subagent' : 'subagents'} running`
  const toggle = open ? 'Hide the subagents' : 'Show the subagents'
  return (
    <div className={`mx-subs${open ? ' is-open' : ''}`}>
      <div className="mx-subs-fade" aria-hidden="true" />
      <section className="mx-subs-card" aria-label={count}>
        {/* The whole bar is the toggle; its name says what a click does, so the first task is not read twice. */}
        <button type="button" className="mx-subs-bar" aria-expanded={open} aria-controls={list} aria-label={toggle} title={toggle} onClick={() => { setOpen(!open) }}>
          <span className="mx-subs-spin" aria-hidden="true"><Spinner /></span>
          <strong className="mx-subs-count">{count}</strong>
          <span className="mx-subs-first"><span className="mx-subs-task">{first.name}</span>{first.latest !== null && <span className="mx-subs-activity"> · {first.latest}</span>}</span>
          {more > 0 && <span className="mx-subs-more">+{more} more</span>}
          <span className="mx-subs-chevron" aria-hidden="true"><Icon name="chevronDown" size={12} /></span>
        </button>
        {open && <ul id={list} className="mx-subs-list">{running.map((subagent) => <SubagentRow key={subagent.id} subagent={subagent} now={now} onOpen={onOpen} />)}</ul>}
      </section>
    </div>
  )
}
