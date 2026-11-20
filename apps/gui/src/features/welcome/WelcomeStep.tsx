import type { KeyboardEvent, Ref } from 'react'
import { APP_NAME } from '@/brand'
import { Button } from '@/components/ui/button'
import { CardList } from '@/components/ui/card'
import { Icon } from '@/features/workspace/components/glyphs'
import { FieldError, fieldErrorProps } from '@/components/ui/feedback'
import { StatusIcon } from '@/components/ui/status-icon'
import { StepHead } from './StepHead'
import type { HomeSuggestion } from './useHomeSuggestions'

const PATH_ERROR_ID = 'mx-onb-home-error'
export const HOME_MISSING = 'That folder was not found. Check the path, or use Browse.'

const POINTS = [
  { mark: <StatusIcon status="needs" />, lead: 'Needs you', rest: 'floats to the top, so nothing waits on you unseen.' },
  { mark: <StatusIcon status="working" />, lead: 'Many at once:', rest: 'each agent gets its own worktree, so they never step on each other.' },
  { mark: <span className="w-3.5 text-center font-(family-name:--mono) text-xs text-(--fg2)">▤</span>, lead: 'Any machine:', rest: 'remote sessions sit right next to local ones.' },
] as const

export type HomeProps = {
  path: string
  onPath: (path: string) => void
  /** Shown under the field when the folder is not there. */
  missing: boolean
  note: string
  suggestions: readonly HomeSuggestion[]
  onBrowse: () => void
  onEnter: () => void
}

/** The home directory: where every new session and terminal opens. A typed path, the system's picker, or a suggestion. */
function HomeField({ path, onPath, missing, note, suggestions, onBrowse, onEnter }: HomeProps) {
  const enter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    event.stopPropagation()
    onEnter()
  }
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="mx-onb-home" className="text-xs font-semibold text-(--fg2)">Home directory</label>
      <span className="text-xs leading-normal text-(--dim)">Every new session and terminal opens here. You can pick a different folder for any one session.</span>
      <div className="flex gap-2">
        <span className="mx-field flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-(--r-control) px-2.5 has-[[aria-invalid=true]]:border-(--err) has-[:focus-visible]:shadow-(--focus-underline)">
          <span aria-hidden="true" className="flex flex-none text-(--dim)"><Icon name="folder" size={15} /></span>
          <input
            id="mx-onb-home"
            value={path}
            spellCheck={false}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent font-(family-name:--mono) text-[12.5px] text-(--fg) outline-none placeholder:text-(--dim)"
            {...fieldErrorProps(PATH_ERROR_ID, missing ? HOME_MISSING : null)}
            onChange={(event) => { onPath(event.target.value) }}
            onKeyDown={enter}
          />
        </span>
        <Button variant="soft" onClick={onBrowse}>Browse…</Button>
      </div>
      {missing && <FieldError id={PATH_ERROR_ID}>{HOME_MISSING}</FieldError>}
      {note !== '' && <p role="alert" className="m-0 text-xs text-(--fg2)">{note}</p>}
      {suggestions.length > 0 && (
        <CardList aria-label="Suggested folders">
          {suggestions.map((suggestion) => (
            <li key={suggestion.path}>
              <button type="button" aria-pressed={suggestion.path === path} onClick={() => { onPath(suggestion.path) }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left outline-none hover:bg-(--hover) aria-pressed:bg-(--sel) focus-visible:shadow-(--focus-underline)">
                <span aria-hidden="true" className="flex flex-none text-(--dim)"><Icon name="folder" size={15} /></span>
                <span className="min-w-0 flex-1 truncate font-(family-name:--mono) text-xs text-(--fg)">{suggestion.path}</span>
                <span className="flex-none text-[11.5px] text-(--dim)">{suggestion.detail}</span>
              </button>
            </li>
          ))}
        </CardList>
      )}
    </div>
  )
}

/** Step 1: what Maiker is, and the folder new sessions open in. */
export function WelcomeStep({ headingRef, home }: { headingRef: Ref<HTMLHeadingElement>; home: HomeProps }) {
  return (
    <>
      <StepHead headingRef={headingRef} title={`Welcome to ${APP_NAME}`} lead={`${APP_NAME} runs your coding agents side by side. Start Claude Code, Codex, Gemini and more in their own panes, on this computer or on any machine you reach over SSH. The sidebar always shows which ones are working, which are done, and which need you.`} />
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {POINTS.map((point) => (
          <li key={point.lead} className="flex items-start gap-2.5 text-[12.5px] leading-normal text-(--fg2)">
            <span aria-hidden="true" className="flex h-[18px] flex-none items-center">{point.mark}</span>
            <span><b className="font-semibold text-(--fg)">{point.lead}</b> {point.rest}</span>
          </li>
        ))}
      </ul>
      <HomeField {...home} />
    </>
  )
}
