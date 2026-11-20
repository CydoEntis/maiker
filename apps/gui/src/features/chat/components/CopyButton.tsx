import { useCopied } from '@/lib/useCopied'

type CopyButtonProps = {
  text: string
  /** The toast's words when the copy fails. */
  failed: string
  /** The accessible name, where "Copy" alone would not say what is copied. */
  label?: string
}

/** Copy on a block or a turn: says Copied for a moment where it was pressed, so no toast crosses the window for something that worked. */
export function CopyButton({ text, failed, label }: CopyButtonProps) {
  const { copied, copy } = useCopied(failed)
  return <button type="button" className="mx-block-action" {...(label === undefined ? {} : { 'aria-label': label })} onClick={() => { copy(text) }}>{copied ? 'Copied' : 'Copy'}</button>
}
