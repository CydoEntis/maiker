import { APP_NAME } from '@/brand'
import type { LocalServiceReport } from '@/api/daemon'

/** The query of the local service's own report (Settings › Updates & repair, and the restart buttons in the older-service messages). */
export const LOCAL_SERVICE_KEY = ['local-service-report']

/** How often the report is read again while Settings › Updates & repair is open: it only reads two small files. */
export const LOCAL_SERVICE_POLL_MS = 15_000

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? '' : 's'}`

export type ServiceState = 'not-running' | 'behind' | 'file-behind' | 'current'

/** What the page says about the service: it does not run, it runs an older release, its file is older, or all is well. */
export function serviceState(report: LocalServiceReport): ServiceState {
  if (!report.running) return 'not-running'
  if (report.behind) return 'behind'
  if (report.fileBehind) return 'file-behind'
  return 'current'
}

export const SERVICE_STATE_WORDS: Record<ServiceState, string> = {
  'not-running': 'Not running',
  behind: 'Needs a restart to finish updating',
  'file-behind': 'Its program file is out of date',
  current: 'Up to date',
}

export type RestartCopy = { title: string; lines: string[]; confirm: string }

/**
 * What a restart will do, said before it runs: the chats are saved, a turn in progress stops, chats come back asleep,
 * and how to bring them back. `force` is the repair for a service that did not update or will not answer: it goes ahead
 * even when the chats cannot be confirmed saved, and says so.
 */
export function restartCopy(report: LocalServiceReport | undefined, force: boolean): RestartCopy {
  const running = report?.running ?? true
  const sessions = report?.sessionCount ?? 0
  const turns = report?.activeTurnCount
  const title = force ? `Force update the ${APP_NAME} service?` : running ? `Restart the ${APP_NAME} service?` : `Start the ${APP_NAME} service?`
  const confirm = force ? 'Force update' : running ? 'Restart service' : 'Start service'
  if (!running) {
    return { title, confirm, lines: [`The service is not running, so no chat is working. ${APP_NAME} replaces its program file if it is out of date and starts it.`, 'Saved chats come back asleep when it starts.'] }
  }
  const lines: string[] = []
  if (report !== undefined && !report.canRestart) {
    lines.push(force
      ? `${APP_NAME} cannot confirm that this service's chats are saved. Going on can lose ${sessions === 0 ? 'them' : plural(sessions, 'chat')}.`
      : `This service's chats are not saved, so ${APP_NAME} will not restart it. Use Force update only if you accept losing them.`)
  } else {
    lines.push(sessions === 0 ? 'No chats are open.' : `Your ${plural(sessions, 'chat')} ${sessions === 1 ? 'is' : 'are'} saved.`)
  }
  if (turns === null || turns === undefined) lines.push('The service cannot say which chats are working. A turn in progress stops and its latest output may be lost.')
  else if (turns > 0) lines.push(`${plural(turns, 'turn')} in progress will stop.`)
  else lines.push('No chat is working right now.')
  if (sessions > 0) lines.push(`Chats come back asleep. After the restart you can press Resume ${plural(sessions, 'chat')}.`)
  if (force) lines.push(`If the service does not stop when asked, ${APP_NAME} ends its process, and replaces the service program if it is out of date.`)
  return { title, lines, confirm }
}

/** Whether a restart may be offered at all: a service whose chats are not saved needs the explicit Force update. */
export const canOfferRestart = (report: LocalServiceReport | undefined): boolean => report === undefined || report.canRestart

/** What Copy details puts on the clipboard for a failed restart: the versions and state, then the host's own text, to send to someone. */
export function failureDetails(report: LocalServiceReport | undefined, raw: string): string {
  const state = report === undefined
    ? 'Service state: unknown'
    : [
        `App: ${report.appVersion}`,
        `Service: ${report.running ? (report.daemonVersion ?? 'running, version not reported') : 'not running'}`,
        `Service file: ${report.fileVersion ?? 'missing or unreadable'}`,
        `Sessions: ${String(report.sessionCount)}, saved: ${report.canRestart ? 'yes' : 'no'}`,
      ].join('\n')
  return `${state}\n\n${raw}`
}
