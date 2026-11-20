import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MaikerMark } from '@/components/ui/maiker-mark'
import { StepBar } from '@/components/ui/step-bar'
import { APP_NAME } from '@/brand'
import { errorMessage } from '@/lib/error-message'
import type { PaneView } from '@/features/workspace/model/chatView'
import { useInstalledAgents } from '@/features/workspace/model/newChatHost'
import { AgentsStep } from './AgentsStep'
import { OnboardingMark, OPENING_MS } from './OnboardingMark'
import { ReviewStep, type ReviewRow } from './ReviewStep'
import { StyleStep } from './StyleStep'
import { ViewStep } from './ViewStep'
import { WelcomeStep } from './WelcomeStep'
import { agentLabel, nextLabel, recommendView, SETUP_AGENTS, SETUP_STEPS, STEP_AGENTS, STEP_REVIEW, STEP_STYLE, STEP_VIEW, STEP_WELCOME, viewName, type StyleAnswers } from './setup'
import { useAgentInstalls } from './useAgentInstalls'
import { useHomeSuggestions } from './useHomeSuggestions'
import './onboarding.css'

/** What Get started applies. */
export type SetupChoices = { startFolder: string; openSessionsIn: PaneView }

type Props = {
  /** This computer's home folder, spelled out; empty until it is known. */
  home: string
  /** The saved start folder; empty means the home folder. */
  startFolder: string
  validateFolder: (path: string) => Promise<boolean>
  /** Opens the system's folder picker; the path picked, or null when cancelled. */
  onChooseFolder: (current: string) => Promise<string | null>
  /** Saves what Get started chose. Skipping saves nothing. */
  onApply: (choices: SetupChoices) => void
  reducedMotion: boolean
  /** The themed window root the setup mounts in, so it reads the theme's tokens. */
  portalContainer: HTMLElement | null
  /** The setup is over. `startSession` is true when Get started was pressed: open the + menu. */
  onClose: (startSession: boolean) => void
}

const LAST_STEP = SETUP_STEPS.length - 1

/** The first-run setup: the mark draws, then five steps in a window over the blurred app. */
export function Onboarding({ home, startFolder, validateFolder, onChooseFolder, onApply, reducedMotion, portalContainer, onClose }: Props) {
  const [phase, setPhase] = useState<'draw' | 'window'>(reducedMotion ? 'window' : 'draw')
  const [step, setStep] = useState(STEP_WELCOME)
  const [back, setBack] = useState(false)
  const [typed, setTyped] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [note, setNote] = useState('')
  const [answers, setAnswers] = useState<StyleAnswers>({})
  const [picked, setPicked] = useState<PaneView | null>(null)
  const installed = useInstalledAgents()
  const installs = useAgentInstalls()
  const heading = useRef<HTMLHeadingElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const nextRef = useRef<() => void>(() => undefined)

  const path = typed ?? (startFolder.trim() === '' ? home : startFolder)
  const suggestions = useHomeSuggestions(home, startFolder.trim())
  const recommended = recommendView(answers)
  const view = picked ?? recommended
  const isHere = (program: string) => program in installs.done || (installed?.includes(program) ?? false)
  const geminiInstalled = isHere('gemini')

  useEffect(() => {
    if (phase !== 'draw') return undefined
    const timer = setTimeout(() => { setPhase('window') }, OPENING_MS)
    return () => { clearTimeout(timer) }
  }, [phase])

  useEffect(() => {
    if (phase !== 'window') return
    heading.current?.focus({ preventScroll: true })
    if (scroller.current) scroller.current.scrollTop = 0
  }, [step, phase])

  const go = (to: number) => {
    if (to < 0 || to > LAST_STEP) return
    setBack(to < step)
    setStep(to)
  }

  const leaveWelcome = async () => {
    const wanted = path.trim()
    if (wanted !== '') {
      setChecking(true)
      const exists = await validateFolder(wanted).catch(() => false)
      setChecking(false)
      if (!exists) { setMissing(true); return }
    }
    go(STEP_AGENTS)
  }

  const finish = () => {
    const wanted = path.trim()
    onApply({ startFolder: wanted === home ? '' : wanted, openSessionsIn: view })
    onClose(true)
  }

  const next = () => {
    if (checking) return
    if (step === STEP_WELCOME) void leaveWelcome()
    else if (step === STEP_REVIEW) finish()
    else go(step + 1)
  }
  useEffect(() => { nextRef.current = next })

  const browse = () => {
    onChooseFolder(path).then(
      (chosen) => { if (chosen !== null) { setTyped(chosen); setMissing(false); setNote('') } },
      (error: unknown) => { setNote(errorMessage(error, 'Could not open the folder picker')) },
    )
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (phase === 'draw') {
      if (event.key === 'Enter' || event.key === 'Escape' || event.key === ' ') { event.preventDefault(); setPhase('window') }
      return
    }
    const target = event.target as HTMLElement
    if (event.key === 'Escape' && step > STEP_WELCOME) { event.preventDefault(); go(step - 1); return }
    if (event.key !== 'Enter' || target.tagName === 'INPUT') return
    // A radio button swallows Enter itself; here it picks, and the person continues with the button.
    if (target.getAttribute('role') === 'radio') { event.preventDefault(); target.click(); return }
    if (target.tagName === 'BUTTON') return
    event.preventDefault()
    nextRef.current()
  }

  const hereNames = SETUP_AGENTS.filter((agent) => isHere(agent.program)).map((agent) => agent.label)
  const installing = Object.values(installs.states).filter((state) => state.phase === 'running').length
  const review: ReviewRow[] = [
    { key: 'home', label: 'Home directory', value: path.trim() === '' ? 'Your user folder' : path.trim(), mono: true, onChange: () => { go(STEP_WELCOME) } },
    { key: 'agents', label: 'Agents', value: `${hereNames.length === 0 ? 'None yet' : hereNames.join(', ')}${installing > 0 ? ` (+${String(installing)} installing)` : ''}`, onChange: () => { go(STEP_AGENTS) } },
    { key: 'view', label: 'Sessions open in', value: `${viewName(view)}${geminiInstalled && view === 'chat' ? ` (${agentLabel('gemini')} in Terminal)` : ''}`, onChange: () => { go(STEP_VIEW) } },
  ]

  return (
    <Dialog open>
      <DialogContent
        unstyled
        container={portalContainer}
        overlayClassName="mx-onb"
        className="mx-onb-win"
        data-reduce={reducedMotion}
        aria-describedby={undefined}
        onKeyDown={onKeyDown}
        // Esc steps back (see onKeyDown) and a click outside does nothing: only Skip setup or the last step ends the setup.
        onEscapeKeyDown={(event) => { event.preventDefault() }}
        onInteractOutside={(event) => { event.preventDefault() }}
        // The heading, not the first button, so Enter reads as "continue" and a screen reader starts at the top.
        onOpenAutoFocus={(event) => { if (phase === 'window') { event.preventDefault(); heading.current?.focus({ preventScroll: true }) } }}
      >
        <DialogTitle className="mx-onb-sr">Set up {APP_NAME}</DialogTitle>
        {phase === 'draw' && <div className="mx-onb-sr" role="status">Opening {APP_NAME}. Press Enter to skip.</div>}
        {!reducedMotion && <OnboardingMark gone={phase === 'window'} />}
        {phase === 'window' && (
          <div className="mx-onb-window flex max-h-[calc(100vh-48px)] w-[680px] max-w-[calc(100%-32px)] flex-col overflow-hidden rounded-(--r-panel) border border-(--line) bg-(--main) shadow-(--pop-sh)">
            <div className="mx-onb-sr" aria-live="polite">{`Step ${String(step + 1)} of ${String(SETUP_STEPS.length)}: ${SETUP_STEPS[step] ?? ''}`}</div>
            <div className="flex flex-none items-center gap-4 border-b border-(--line) px-5 py-3.5">
              <MaikerMark width={26} height={20} />
              <StepBar className="min-w-0 flex-1" label="Setup progress" steps={SETUP_STEPS} current={step} onSelect={go} skip={{ label: 'Skip setup', onSkip: () => { onClose(false) } }} />
            </div>
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
              <section key={step} data-back={back} aria-labelledby="mx-onb-h" className="mx-onb-screen flex flex-col gap-5 px-7 py-6">
                {step === STEP_WELCOME && (
                  <WelcomeStep
                    headingRef={heading}
                    home={{ path, onPath: (value) => { setTyped(value); setMissing(false) }, missing, note, suggestions, onBrowse: browse, onEnter: next }}
                  />
                )}
                {step === STEP_AGENTS && <AgentsStep headingRef={heading} installed={installed} states={installs.states} done={installs.done} actions={installs} />}
                {step === STEP_STYLE && <StyleStep headingRef={heading} answers={answers} onAnswer={(question, value) => { setAnswers((current) => ({ ...current, [question]: value })); setPicked(null) }} />}
                {step === STEP_VIEW && <ViewStep headingRef={heading} answers={answers} recommended={recommended} chosen={view} onChoose={setPicked} geminiInstalled={geminiInstalled} />}
                {step === STEP_REVIEW && <ReviewStep headingRef={heading} rows={review} />}
              </section>
            </div>
            <div className="flex flex-none items-center gap-2 border-t border-(--line) px-5 py-3">
              <Button variant="ghost" className={step === STEP_WELCOME ? 'invisible' : ''} tabIndex={step === STEP_WELCOME ? -1 : 0} onClick={() => { go(step - 1) }}>Back</Button>
              <span className="flex-1" />
              <span className="flex items-center gap-1.5 text-[11.5px] text-(--dim)"><kbd className="rounded-(--r-badge) px-1 font-(family-name:--mono) text-[10.5px] shadow-[inset_0_0_0_1px_var(--line2)]">Enter</kbd>{step === STEP_REVIEW ? 'to start' : 'to continue'}</span>
              <Button disabled={checking} onClick={next}>{nextLabel(step, answers)}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
