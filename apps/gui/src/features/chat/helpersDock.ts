import { createContext } from 'react'
import type { SubagentEvent } from './chatEvents'
import type { ChatRow } from './chatRows'
import { subagentNamed } from './openSubagent'
import type { SubagentView } from '@/features/workspace/model/subagents'

/** The agents row the dock above the message box follows, and the way to open its list; null while no helper works. */
export type HelpersLive = { readonly key: string; readonly open: () => void }
export const HelpersLiveContext = createContext<HelpersLive | null>(null)

/** How a helper reads in the dock: working, finished, or not finished (failed, or stopped with its turn). */
export type HelperStatus = 'working' | 'done' | 'failed'

/** One helper as the dock draws it, from what the chat's history kept and, while it works, what the runtime says it is doing. */
export type DockHelper = {
  readonly id: string
  readonly label: string
  /** The helper's type (`Explore`), at the right of its row. */
  readonly kind: string | null
  readonly status: HelperStatus
  /** What it is doing right now; only a working helper has one. */
  readonly activity: string | null
  readonly asked: string | null
  /** The last thing the runtime saw it run. */
  readonly ran: string | null
  /** Its report, or for a failed one what went wrong. */
  readonly answer: string | null
  /** The helper was stopped (its turn ended) rather than reporting a failure. */
  readonly stopped: boolean
}

/** How often the line shows another working helper. */
export const CYCLE_MS = 3200

const STATUS_OF: Record<SubagentEvent['status'], HelperStatus> = {
  running: 'working',
  completed: 'done',
  failed: 'failed',
  interrupted: 'failed',
}

/** The helpers of one agents row, with what each is doing from the runtime's list (matched by title or first line of its task). */
export function dockHelpers(events: readonly SubagentEvent[], views: readonly SubagentView[]): DockHelper[] {
  return events.map((event) => {
    const asked = event.prompt?.split('\n')[0]?.trim() ?? null
    const status = STATUS_OF[event.status]
    // A helper that needs you, or stopped while its session still works, is still in the runtime's list: matched like a
    // working one, so its detail has what it last ran. A finished one has reported back and is gone from it.
    const view = status === 'done' ? null : subagentNamed(views, event.title, asked)
    const report = event.report.trim()
    return {
      id: event.id,
      label: event.title ?? event.agentType ?? 'A helper agent',
      kind: event.title !== null ? event.agentType : null,
      status,
      activity: status === 'working' ? view?.latest ?? null : null,
      asked: event.prompt?.trim() ?? null,
      ran: view?.latest ?? null,
      answer: report === '' ? null : report,
      stopped: event.status === 'interrupted',
    }
  })
}

/**
 * The agents row the dock follows: the last one in the chat that still has a helper working. Null when none does, which
 * is when the dock line goes and the row shows its full record.
 */
export function liveAgentsRow(rows: readonly ChatRow[]): { key: string; events: readonly SubagentEvent[] } | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row?.kind === 'agents' && row.events.some((event) => event.status === 'running')) return { key: row.key, events: row.events }
  }
  return null
}

export type HelperCounts = { readonly working: number; readonly done: number; readonly failed: number }

export function helperCounts(helpers: readonly DockHelper[]): HelperCounts {
  return {
    working: helpers.filter((helper) => helper.status === 'working').length,
    done: helpers.filter((helper) => helper.status === 'done').length,
    failed: helpers.filter((helper) => helper.status === 'failed').length,
  }
}

/** The working helper the line names on this tick: each in turn, so every one gets its moment. */
export function currentHelper(helpers: readonly DockHelper[], tick: number): DockHelper | null {
  const working = helpers.filter((helper) => helper.status === 'working')
  return working.length === 0 ? null : (working[tick % working.length] ?? null)
}

const STRIP_ORDER: Record<HelperStatus, number> = { done: 0, failed: 1, working: 2 }

/** The progress strip's blocks, finished first, so it fills from the left as helpers finish. */
export function stripOrder(helpers: readonly DockHelper[]): DockHelper[] {
  return helpers.slice().sort((a, b) => STRIP_ORDER[a.status] - STRIP_ORDER[b.status])
}
