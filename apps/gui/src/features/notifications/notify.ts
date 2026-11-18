import type { ReactNode } from 'react'
import { toast, type ToastAction, type ToastOptions } from '@/lib/toast'

export type NoticeAction = {
  label: string
  onClick: () => void
  /** The one button that answers the notice, in its status colour. */
  primary?: boolean
}

/** What a toast about something you are not looking at says: who it is about, what happened, and what you can do. */
export type Notice = {
  /** needs: waits on you (stays); done: finished (hides after 4s); error: failed (stays); info: a plain note. */
  kind: 'needs' | 'done' | 'error' | 'info'
  /** Who it is about: a session's name. */
  title: string
  /** What happened to it, in words, after the name ("needs you", "finished", "failed"). */
  state?: string
  body?: ReactNode
  actions?: readonly NoticeAction[]
}

const asAction = (action: NoticeAction): ToastAction => ({ label: action.label, onClick: () => { action.onClick() } })

function optionsOf(notice: Notice, id?: string): ToastOptions {
  const actions = notice.actions ?? []
  const primary = actions.find((action) => action.primary === true) ?? actions[0]
  const secondary = actions.find((action) => action !== primary)
  return {
    ...(id === undefined ? {} : { id }),
    ...(notice.body === undefined ? {} : { description: notice.body }),
    ...(primary === undefined ? {} : { action: asAction(primary) }),
    ...(secondary === undefined ? {} : { secondary: asAction(secondary) }),
  }
}

const SHOW = { needs: toast.needs, done: toast.success, error: toast.error, info: toast.info } as const

/** Shows a notice as a toast in its status colour. */
export function showNotice(notice: Notice, id?: string): string {
  const title = notice.state === undefined || notice.state === '' ? notice.title : `${notice.title} ${notice.state}`
  return SHOW[notice.kind](title, optionsOf(notice, id))
}

const sessionToastId = (sessionId: string) => `session-${sessionId}`

/** Takes a session's toast away, e.g. once the session is no longer waiting on you. */
export function dismissSessionNotice(sessionId: string): void {
  toast.dismiss(sessionToastId(sessionId))
}

/**
 * A toast for a session you are not looking at. A newer one for the same session replaces the older, so a session never
 * stacks toasts; one that needs you or failed stays until you act, a finished one goes by itself.
 */
export function showSessionNotice(sessionId: string, notice: Notice): string {
  return showNotice(notice, sessionToastId(sessionId))
}
