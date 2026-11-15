import { useEffect, useRef } from 'react'
import { ResultsList, ResultsOption } from '@/components/ui/results-list'
import { commandLabel, type SlashCommand } from '../slashCommands'
import { ASKS_FIRST } from '../windowCommands'

/** The most rows drawn: past this a name is typed further, not scrolled to. */
export const MAX_SHOWN = 50

type Props = {
  agent: string
  /** What is typed in the box, said back when no command has that name. */
  typed: string
  /** The commands that match what is typed, closest first. */
  matches: readonly SlashCommand[]
  /** Which of them the keys are on. */
  active: number
  loading: boolean
  error: string | null
  onPick: (command: SlashCommand) => void
  onHover: (index: number) => void
}

/**
 * The agent's commands, over the message box while a slash and a name are being typed: each with what it
 * does and what it takes. The keys stay in the box (the composer moves `active`); a click picks one.
 */
export function SlashPicker({ agent, typed, matches, active, loading, error, onPick, onHover }: Props) {
  const list = useRef<HTMLDivElement>(null)
  // The row the keys are on stays in view as they move through a list longer than the panel.
  useEffect(() => {
    const row = list.current?.children.item(active)
    if (row instanceof HTMLElement && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  }, [active])
  const shown = matches.slice(0, MAX_SHOWN)
  const none = matches.length === 0 && !loading && error === null
  const note = matches.length > 0 || none ? null
    : loading ? `Asking ${agent} for its commands…`
    : `Could not list ${agent}'s commands: ${String(error)}`
  return (
    <div className="mx-slash" role="presentation" onMouseDown={(event) => { event.preventDefault() }}>
      <p className="mx-slash-head"><span>Commands</span><span className="mx-spacer" /><span className="mx-slash-count">{matches.length}</span></p>
      {note !== null && <p className="mx-slash-note" role="status">{note}</p>}
      {none && (
        <div className="mx-slash-none" role="status">
          <span className="mx-slash-none-title">No command by that name</span>
          <span>Press Enter to send <code>{typed}</code> to the agent as a message.</span>
        </div>
      )}
      {shown.length > 0 && (
        <ResultsList ref={list} id="mx-slash-list" className="mx-slash-list" aria-label={`${agent} commands`}>
          {shown.map((command, index) => (
            <ResultsOption
              key={commandLabel(command)}
              id={`mx-slash-${String(index)}`}
              selected={index === active}
              className={`mx-slash-row${index === active ? ' is-active' : ''}`}
              onMouseMove={() => { if (index !== active) onHover(index) }}
              onClick={() => { onPick(command) }}
            >
              <span className="mx-slash-name">{commandLabel(command)}{command.hint !== '' && <span className="mx-slash-hint"> {command.hint}</span>}</span>
              <span className="mx-slash-what">{command.opens !== undefined && <span className="mx-slash-tag" title={command.opens === ASKS_FIRST ? 'Asks before it runs' : `Opens ${command.opens} in Maitty`}>{command.opens}</span>}{command.terminal === true && command.opens === undefined && <span className="mx-slash-tag" title="Opens in the terminal">terminal</span>}{command.skill === true && <span className="mx-slash-tag" title="Named in your message for the agent to use">skill</span>}{command.description}</span>
            </ResultsOption>
          ))}
        </ResultsList>
      )}
      {matches.length > MAX_SHOWN && <p className="mx-slash-note">{matches.length - MAX_SHOWN} more: keep typing to narrow them down.</p>}
      <p className="mx-slash-keys"><span><kbd>↑↓</kbd> choose</span><span><kbd>Tab</kbd> complete</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span></p>
    </div>
  )
}
