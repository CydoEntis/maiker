import { openLink } from '@/api/daemon'
import { copyText } from '@/lib/clipboard'
import { toast } from '@/lib/toast'

/** Opens a sign-in's link in the browser; says so when it cannot. */
export function openSignInLink(link: string): void {
  openLink(link).catch((error: unknown) => { toast.failed('Could not open the browser', error) })
}

/** Copies a sign-in's one-time code; says so either way. */
export function copySignInCode(code: string): void {
  copyText(code).then(
    () => { toast.info('Code copied') },
    () => { toast.error('Could not copy the code') },
  )
}
