type Props = {
  /** What is shown after the prompt, exactly as it will be run. */
  command: string
  /** The shell's prompt mark: `$`, or `PS>` for PowerShell. */
  prompt: string
  /** The accessible name of the block ("The command Maiker will run"). */
  label: string
}

/** A command as a terminal would show it: a read-only, rounded well with a prompt, in the terminal's mono. It is not a terminal and runs nothing. */
export function CommandPreview({ command, prompt, label }: Props) {
  return (
    <pre className="mx-cmd-preview" role="group" aria-label={label}>
      <span aria-hidden="true" className="mx-cmd-prompt">{prompt}</span>
      <code>{command}</code>
    </pre>
  )
}
