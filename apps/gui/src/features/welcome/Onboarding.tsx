import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { APP_NAME } from '@/brand'
import { FieldError, fieldErrorProps } from '@/components/ui/feedback'
import { errorMessage } from '@/lib/error-message'
import { AddMachinePanel } from '@/features/settings/components/AddMachinePanel'
import type { MachinesInfo } from '@/features/settings/components/DesktopSettings'
import { useInstalledAgents } from '@/features/workspace/model/newChatHost'
import { folderNameOf, LAST_STEP, nextLabel, SETUP_AGENTS, SETUP_STEPS, type StartChoice } from './setup'
import './onboarding.css'

const FOLDER_ERROR_ID = 'mx-onb-folder-error'
const FOLDER_MISSING = 'That folder was not found. Check the path, or use Browse.'
const MACHINE_PANEL = '.mx-rm-add'

type Props = {
  /** What a new session opens in is chosen here; the window saves it. */
  /** The folder new sessions start in. */
  onStartFolder: (path: string) => void
  validateFolder: (path: string) => Promise<boolean>
  /** Opens the system's folder picker; the path picked, or null when cancelled. */
  onChooseFolder: (current: string) => Promise<string | null>
  /** What the add-a-machine panel needs; the same calls Settings › Remote machines makes. */
  machines: MachinesInfo
  reducedMotion: boolean
  /** The themed window root the setup mounts in, so it reads the theme's tokens. */
  portalContainer: HTMLElement | null
  /** Finished, skipped: the setup is done. `startSession` is true when a folder was picked to start in. */
  onClose: (startSession: boolean) => void
}

const DEMO_ROWS = [
  { glyph: '!', tone: 'needs', name: 'Fix the out-of-date lockfile', where: 'acme-store · main', word: 'needs you', on: true },
  { glyph: '', tone: 'working', name: 'Add a refunds endpoint', where: 'billing-api · devbox', word: 'working', on: false },
  { glyph: '✓', tone: 'done', name: 'Update the API docs', where: 'docs-site · main', word: 'done', on: false },
] as const

/** The first-run setup: what this is and where to start. Full screen, two steps. */
export function Onboarding({ onStartFolder, validateFolder, onChooseFolder, machines, reducedMotion, portalContainer, onClose }: Props) {
  const [step, setStep] = useState(0)
  const [back, setBack] = useState(false)
  const [start, setStart] = useState<StartChoice | null>(null)
  const [path, setPath] = useState('')
  const [missing, setMissing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [note, setNote] = useState('')
  const installed = useInstalledAgents()
  const heading = useRef<HTMLHeadingElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const nextRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    if (scroller.current) scroller.current.scrollTop = 0
  }, [step])

  const folderName = folderNameOf(path)
  const go = (to: number) => {
    if (to < 0 || to > LAST_STEP) return
    setBack(to < step)
    setStep(to)
  }

  const startInFolder = async () => {
    const typed = path.trim()
    if (typed === '') return
    setChecking(true)
    const exists = await validateFolder(typed).catch(() => false)
    setChecking(false)
    if (!exists) { setMissing(true); return }
    onStartFolder(typed)
    onClose(true)
  }

  const canNext = step === 0 || (step === LAST_STEP && start === 'folder' && folderName !== null && !checking)
  const next = () => {
    if (!canNext) return
    if (step < LAST_STEP) go(step + 1)
    else void startInFolder()
  }

  const browse = () => {
    onChooseFolder(path).then(
      (picked) => { if (picked !== null) { setPath(picked); setMissing(false); setNote('') } },
      (error: unknown) => { setNote(errorMessage(error, 'Could not open the folder picker')) },
    )
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    // The add-a-machine panel owns its own keys (Esc ends the ssh look there).
    if (target.closest(MACHINE_PANEL) !== null) return
    if (event.key === 'Escape' && step > 0) { event.preventDefault(); go(step - 1); return }
    if (event.key !== 'Enter' || target.tagName === 'INPUT') return
    // A radio button swallows Enter itself (so a form does not submit); here it picks and continues.
    const isRadio = target.getAttribute('role') === 'radio'
    if (target.tagName === 'BUTTON' && !isRadio) return
    event.preventDefault()
    if (isRadio) target.click()
    // Let the pick land before the step reads it: the latest `next` sees the new state.
    setTimeout(() => { nextRef.current() }, 0)
  }

  useEffect(() => { nextRef.current = next })
  const label = nextLabel(step, start, folderName)
  const machineOpen = step === LAST_STEP && start === 'machine'
  const live = `Step ${String(step + 1)} of ${String(SETUP_STEPS.length)}: ${SETUP_STEPS[step] ?? ''}`

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
      // Esc steps back (see onKeyDown) and a click outside does nothing: only Skip or the last step ends the setup.
      onEscapeKeyDown={(event) => { event.preventDefault() }}
      onInteractOutside={(event) => { event.preventDefault() }}
      // The heading, not the first button, so Enter reads as "continue" and a screen reader starts at the top.
      onOpenAutoFocus={(event) => { event.preventDefault(); heading.current?.focus({ preventScroll: true }) }}
    >
      <DialogTitle className="mx-onb-sr">Set up {APP_NAME}</DialogTitle>
      <div className="mx-onb-sr" aria-live="polite">{live}</div>
      <div className="mx-onb-scroll" ref={scroller}>
        <div className="mx-onb-col">
          <nav className="mx-onb-prog" aria-label="Setup progress">
            {SETUP_STEPS.map((name, index) => (
              <span key={name} className="mx-onb-progitem">
                {index > 0 && <span className="mx-onb-bar" data-on={index <= step} />}
                <span className="mx-onb-st" data-s={index < step ? 'done' : index === step ? 'now' : 'todo'} aria-current={index === step ? 'step' : undefined}>
                  <span className="mx-onb-n">{index < step ? '✓' : String(index + 1)}</span>{name}
                </span>
              </span>
            ))}
          </nav>

          <section className="mx-onb-screen" data-back={back} key={step} aria-labelledby="mx-onb-h">
            {step === 0 && (
              <>
                <div>
                  <h2 id="mx-onb-h" tabIndex={-1} ref={heading}>Welcome to {APP_NAME}</h2>
                  <p className="mx-onb-lead">See which agents need you, jump to them, and keep them running when you close the app.</p>
                </div>
                <div className="mx-onb-wel">
                  <div className="mx-onb-mini" role="img" aria-label="Example: your sessions in the sidebar">
                    <div className="mx-onb-minih">Your sessions<small>{DEMO_ROWS.length}</small></div>
                    {DEMO_ROWS.map((row) => (
                      <div key={row.name} className="mx-onb-mrow" data-on={row.on}>
                        <span className="mx-onb-g" data-tone={row.tone}>{row.tone === 'working' ? <span className="mx-onb-spin" /> : row.glyph}</span>
                        <span className="mx-onb-mt"><b>{row.name}</b><small>{row.where}</small></span>
                        <span className="mx-onb-mw" data-tone={row.tone}>{row.word}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mx-onb-facts">
                    <Fact tone="needs" mark="!">Amber means an agent is waiting on you.</Fact>
                    <Fact tone="plain" mark="→">Click a session to jump to it. The ones that need you sit at the top.</Fact>
                    <Fact tone="working" mark="▢">Close the window and they keep working.</Fact>
                  </div>
                </div>
                <div className="mx-onb-agents">
                  <span>Agents on this computer:</span>
                  {installed === null
                    ? <span>looking…</span>
                    : SETUP_AGENTS.map(({ program, label: agent }) => {
                      const found = installed.includes(program)
                      return <span key={program} className="mx-onb-chip" data-off={!found}><b>{found ? '✓' : '–'}</b>{agent}</span>
                    })}
                  {installed !== null && !installed.includes('gemini') && <span>Gemini shows up here once its CLI is installed.</span>}
                </div>
              </>
            )}

            {step === LAST_STEP && (
              <>
                <div>
                  <h2 id="mx-onb-h" tabIndex={-1} ref={heading}>Get started</h2>
                  <p className="mx-onb-lead">Start with code on this computer, or connect another one. You can add more later.</p>
                </div>
                <RadioGroup className="mx-onb-opts" aria-labelledby="mx-onb-h" value={start ?? ''} onValueChange={(value) => { if (value === 'folder' || value === 'machine') setStart(value) }}>
                  <StartOption value="folder" title="Add a project folder" detail="A folder on this computer, usually a git repo." />
                  <StartOption value="machine" title="Connect a remote machine" detail="Another computer you reach over SSH." />
                </RadioGroup>

                {start === 'folder' && (
                  <div className="mx-onb-sub" role="group" aria-label="Pick a project folder">
                    <label className="mx-onb-sublbl" htmlFor="mx-onb-path">Folder</label>
                    <div className="mx-onb-pathrow">
                      <input
                        id="mx-onb-path"
                        value={path}
                        placeholder="~/path/to/project"
                        data-bad={missing}
                        {...fieldErrorProps(FOLDER_ERROR_ID, missing ? FOLDER_MISSING : null)}
                        spellCheck={false}
                        autoComplete="off"
                        autoFocus
                        onChange={(event) => { setPath(event.target.value); setMissing(false) }}
                        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); next() } }}
                      />
                      <button type="button" className="mx-onb-btn" onClick={browse}>Browse…</button>
                    </div>
                    {missing && <FieldError id={FOLDER_ERROR_ID}>{FOLDER_MISSING}</FieldError>}
                    {note !== '' && <p className="mx-onb-small" role="alert">{note}</p>}
                  </div>
                )}

                {machineOpen && (
                  <div className="mx-onb-sub" role="group" aria-label="Connect a remote machine">
                    <AddMachinePanel machines={machines} embedded onClose={() => { setStart(null) }} onAdded={() => { onClose(false) }} />
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      <div className="mx-onb-foot">
        <div className="mx-onb-in">
          <button type="button" className="mx-onb-btn" data-k="txt" aria-label="Back" data-hide={step === 0} tabIndex={step === 0 ? -1 : 0} onClick={() => { go(step - 1) }}>‹ Back</button>
          <span className="mx-onb-keys"><kbd>Enter</kbd>{machineOpen ? 'connect' : 'continue'}{step > 0 && <><span className="mx-onb-gap" /><kbd>Esc</kbd>back</>}</span>
          <button type="button" className="mx-onb-btn" data-k="txt" onClick={() => { onClose(false) }}>Skip for now</button>
          {!machineOpen && (
            <button type="button" className="mx-onb-btn" data-k="pri" data-off={!canNext} aria-disabled={!canNext} onClick={next}>{label}</button>
          )}
        </div>
      </div>
    </DialogContent>
    </Dialog>
  )
}

function Fact({ tone, mark, children }: { tone: 'needs' | 'plain' | 'working'; mark: string; children: ReactNode }) {
  return <div className="mx-onb-fact"><span className="mx-onb-k" data-tone={tone}>{mark}</span><span>{children}</span></div>
}

function StartOption({ value, title, detail }: { value: StartChoice; title: string; detail: string }) {
  return (
    <RadioGroupItem value={value} className="mx-onb-opt">
      <span className="mx-onb-tx"><b>{title}</b><span>{detail}</span></span>
      <span className="mx-onb-rd" />
    </RadioGroupItem>
  )
}
