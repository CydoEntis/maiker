import { stripAnsi } from '@/features/settings/model/keyCommand'

/** How long a new shell may take to show something before the line is typed anyway: a profile that never prints must not hold the step. */
export const PROMPT_WAIT_MS = 8000
const POLL_MS = 150
/** The screen must hold still this long: a prompt is drawn in pieces, and a banner is followed by it. */
const STILL_MS = 500

const sleep = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms) })

/**
 * Resolves once a new shell has drawn something and stopped drawing, which is when it reads typed input; a line sent before that
 * can be dropped or redrawn over by a slow shell profile. Gives up after `PROMPT_WAIT_MS` and resolves anyway, as a shell that
 * says nothing is still a shell that takes the line.
 */
export async function waitForPrompt(read: () => Promise<string>): Promise<void> {
  const deadline = Date.now() + PROMPT_WAIT_MS
  let last = ''
  let stillSince = Date.now()
  while (Date.now() < deadline) {
    const now = stripAnsi(await read().catch(() => '')).trim()
    if (now !== last) {
      last = now
      stillSince = Date.now()
    } else if (now !== '' && Date.now() - stillSince >= STILL_MS) {
      return
    }
    await sleep(POLL_MS)
  }
}
