import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { Dialog, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MaikerMark } from '@/components/ui/maiker-mark'
import { APP_NAME } from '@/brand'
import type { PaneView } from '@/features/workspace/model/chatView'
import { useInstalledAgents } from '@/features/workspace/model/newChatHost'
import { findTheme, THEMES } from '@/features/workspace/theme/themes'
import { IntroMark, INTRO_MS, INTRO_STILL_MS } from './IntroMark'
import { SetupScreen } from './SetupScreen'
import { StyleScreen } from './StyleScreen'
import { backFrom, continueFrom, keyStep, SCREENS, settingsFromSetup, skipFrom, stepTheme, type KeyTarget, type SetupSettings, type Stage, type Step } from './setup'
import { useAgentInstalls } from './useAgentInstalls'
import { useProjectsFolder } from './useProjectsFolder'
import './onboarding.css'

type Props = {
  /** This computer's home folder, spelled out; empty until it is known. */
  home: string
  /** The saved projects folder; empty means the home folder. */
  startFolder: string
  /** Opens the system's folder picker; the path picked, or null when cancelled. */
  onChooseFolder: (current: string) => Promise<string | null>
  /** The theme the window is in, by name: where the carousel starts. */
  theme: string
  /** Shows a theme on the whole window without saving it; null goes back to the saved one. */
  onPreviewTheme: (name: string | null) => void
  reducedMotion: boolean
  /** The themed window root the setup mounts in, so it reads the theme's tokens. */
  portalContainer: HTMLElement | null
  /** The last button: what to save, and the projects folder to open the palette in. */
  onFinish: (settings: SetupSettings, folder: string) => void
  /** Skip or Esc: nothing is saved. */
  onSkip: () => void
}

const THEME_NAMES = THEMES.map((entry) => entry.name)
const HEADING_ID = 'mx-onb-h'

/** What a key landed on, for `keyStep`. A radio is not an action: Enter never picks one, so there it continues. */
function keyTargetOf(target: HTMLElement): KeyTarget {
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return 'field'
  if (target.closest('[data-slot="radio-group"]') !== null) return 'choice'
  return target.tagName === 'BUTTON' ? 'action' : 'other'
}

/**
 * The first run: the mark draws itself over the blurred app while the scans start, then one window of two screens,
 * setup and style. It ends in the Open a project palette (`onFinish`) or by Skip (`onSkip`).
 */
export function Onboarding({ home, startFolder, onChooseFolder, theme, onPreviewTheme, reducedMotion, portalContainer, onFinish, onSkip }: Props) {
  const [stage, setStage] = useState<Stage>('intro')
  const [view, setView] = useState<PaneView>('chat')
  const [slid, setSlid] = useState<string | null>(null)
  // Both scans and the installer are mounted with the drawing, so they run while it draws.
  const found = useInstalledAgents()
  const installs = useAgentInstalls()
  const folder = useProjectsFolder(home, startFolder.trim(), onChooseFolder)
  const heading = useRef<HTMLHeadingElement>(null)
  const shownTheme = slid ?? theme

  useEffect(() => {
    if (stage !== 'intro') return undefined
    const timer = setTimeout(() => { setStage('setup') }, reducedMotion ? INTRO_STILL_MS : INTRO_MS)
    return () => { clearTimeout(timer) }
  }, [stage, reducedMotion])

  // The heading, not the first button, so Enter reads as "continue" and a screen reader starts at the top of each screen.
  useEffect(() => {
    if (stage !== 'intro') heading.current?.focus({ preventScroll: true })
  }, [stage])

  // A preview never outlives the setup, however it goes away.
  useEffect(() => () => { onPreviewTheme(null) }, [onPreviewTheme])

  const slideTo = (name: string) => { setSlid(name); onPreviewTheme(name) }

  const take = (step: Step) => {
    if ('stage' in step) { setStage(step.stage); return }
    if (step.end === 'skip') { onSkip(); return }
    const path = folder.path === '' ? home : folder.path
    onFinish(settingsFromSetup({ folder: path, home, view, theme: slid === null ? null : findTheme(slid) }), path)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A menu of the window is drawn outside it, and its keys are its own.
    if (!event.currentTarget.contains(event.target as Node)) return
    if (stage === 'intro') {
      // Esc reaches `onEscapeKeyDown`, which does the same.
      if (event.key !== 'Escape') { event.preventDefault(); setStage('setup') }
      return
    }
    const step = keyStep(stage, event.key, keyTargetOf(event.target as HTMLElement))
    if (step === null) return
    event.preventDefault()
    if (step.kind === 'continue') take(continueFrom(stage))
    else slideTo(stepTheme(THEME_NAMES, shownTheme, step.by))
  }

  const screen = SCREENS.indexOf(stage === 'style' ? 'style' : 'setup')
  const progress = `Step ${String(screen + 1)} of ${String(SCREENS.length)}`

  return (
    <Dialog open>
      <DialogPortal container={portalContainer}>
        <DialogPrimitive.Overlay data-slot="onboarding-veil" className="mx-onb-veil" />
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className="mx-onb"
          data-reduce={reducedMotion}
          data-stage={stage}
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          onPointerDown={() => { if (stage === 'intro') setStage('setup') }}
          // Esc is the window's Skip, and a click outside does nothing: only Skip or the last button ends the setup.
          onEscapeKeyDown={(event) => { event.preventDefault(); take(skipFrom(stage)) }}
          onInteractOutside={(event) => { event.preventDefault() }}
        >
          <DialogTitle className="mx-onb-sr">Set up {APP_NAME}</DialogTitle>
          {stage === 'intro' && <div className="mx-onb-sr" role="status">Opening {APP_NAME}. Press any key to skip.</div>}
          <IntroMark gone={stage !== 'intro'} />
          {stage !== 'intro' && (
            <div className="mx-onb-window">
              <div className="mx-onb-sr" aria-live="polite">{progress}</div>
              <div className="mx-onb-head">
                <MaikerMark width={24} height={19} decorative />
                <span className="mx-onb-dots" role="img" aria-label={progress}>
                  {SCREENS.map((name, index) => <i key={name} data-at={index === screen ? 'now' : index < screen ? 'done' : 'todo'} />)}
                </span>
                <span className="flex-1" />
                <Button variant="ghost" size="md" className="font-normal text-(--dim)" onClick={onSkip}>Skip</Button>
              </div>
              <div className="mx-onb-body">
                <section key={stage} aria-labelledby={HEADING_ID} className="mx-onb-screen" data-screen={stage}>
                  {stage === 'setup'
                    ? <SetupScreen headingId={HEADING_ID} headingRef={heading} folder={folder} found={found} installs={installs} portalContainer={portalContainer} />
                    : <StyleScreen headingId={HEADING_ID} headingRef={heading} view={view} onView={setView} theme={shownTheme} onTheme={slideTo} />}
                </section>
              </div>
              <div className="mx-onb-foot">
                {stage === 'style' && <Button variant="ghost" size="lg" onClick={() => { setStage(backFrom(stage)) }}>Back</Button>}
                <span className="flex-1" />
                <kbd aria-hidden="true" className="mx-onb-kbd">Enter</kbd>
                <Button variant="solid" size="xl" onClick={() => { take(continueFrom(stage)) }}>{stage === 'style' ? 'Open your first project' : 'Continue'}</Button>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
