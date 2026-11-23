import type { CSSProperties } from 'react'
import { IconButton } from '@/components/ui/icon-button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { THEMES, type ThemeEntry } from '@/features/workspace/theme/themes'
import { stepTheme, themeCaption } from './setup'

/** A card's width with the gap to the next, and half a card, which place the track: the picked card sits in the middle (onboarding.css draws the same sizes). */
const CARD_PITCH = 246
const CARD_HALF = 116
/** More themes than this and a dot each no longer fits under the cards, so the place is said in words. */
const MOST_DOTS = 24


/** The theme's own colours as the card's custom properties: it is drawn in its theme, not in the one showing. */
function cardColours(theme: ThemeEntry): CSSProperties {
  const { roles } = theme
  return { '--c-ground': roles.t0, '--c-card': roles.t1, '--c-sel': roles.t2, '--c-box': roles.t3, '--c-fg': roles.fg, '--c-muted': roles.muted, '--c-ink': roles.ink, '--c-needs': roles.needs, '--c-ok': roles.ok } as CSSProperties
}

/** A tiny Maiker: the title bar, the sidebar with its status dots, and the chat with a needs-you line and the chat box. */
function MiniApp() {
  return (
    <>
      <span className="mx-mini-bar"><i className="mx-mini-logo" /><i className="mx-mini-word" /></span>
      <span className="mx-mini-body">
        <span className="mx-mini-side">
          <i className="mx-mini-group" />
          <i className="mx-mini-row" data-k="needs"><b /><u /></i>
          <i className="mx-mini-row" data-k="sel"><b /></i>
          <i className="mx-mini-row" data-k="ok"><b /><u /></i>
          <i className="mx-mini-row" data-k="idle"><b /></i>
          <i className="mx-mini-group" />
          <i className="mx-mini-row" data-k="idle"><b /></i>
        </span>
        <span className="mx-mini-main">
          <i className="mx-mini-said" />
          <i className="mx-mini-text" style={{ width: '78%' }} />
          <i className="mx-mini-text" style={{ width: '62%' }} />
          <i className="mx-mini-text" style={{ width: '70%' }} />
          <i className="mx-mini-needs"><b /></i>
          <i className="mx-mini-box"><b /></i>
        </span>
      </span>
    </>
  )
}

type Props = {
  /** The id of the visible label that names the group. */
  labelledBy: string
  /** The theme showing, by name. */
  value: string
  onPick: (name: string) => void
  /** The themes it slides through, by name: one kind, dark or light, chosen above it. */
  names: readonly string[]
}

/**
 * Every theme as a card drawn in its own colours, one in the middle and its neighbours fading at the sides. It is a
 * radio group with one Tab stop: the arrows pick the theme before or after, going round, and so do the two buttons.
 * The track moves by `transform` alone, and the group clips without scrolling, so focusing a card never shifts it.
 */
export function ThemeCarousel({ labelledBy, value, onPick, names }: Props) {
  const themes = names.flatMap((name) => THEMES.filter((theme) => theme.name === name))
  const at = Math.max(0, names.indexOf(value))
  const current = themes[at]

  const step = (by: number) => { onPick(stepTheme(names, value, by)) }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex w-full items-center gap-1.5">
        <IconButton label="Previous theme" onClick={() => { step(-1) }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg></IconButton>
        <RadioGroup aria-labelledby={labelledBy} value={value} onValueChange={onPick} className="mx-onb-themes">
          <div className="mx-onb-track" style={{ transform: `translateX(${String(-(at * CARD_PITCH + CARD_HALF))}px)` }}>
            {themes.map((theme) => (
              <RadioGroupItem key={theme.name} value={theme.name} aria-label={themeCaption(theme)} className="mx-onb-theme" style={cardColours(theme)}>
                <MiniApp />
              </RadioGroupItem>
            ))}
          </div>
        </RadioGroup>
        <IconButton label="Next theme" onClick={() => { step(1) }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></IconButton>
      </div>
      <div className="flex flex-col items-center gap-2 text-[13px]" aria-hidden="true">
        <b className="font-semibold text-(--fg)">{current === undefined ? value : themeCaption(current)}</b>
        {themes.length <= MOST_DOTS
          ? <span className="mx-onb-dots">{themes.map((theme) => <i key={theme.name} data-at={theme.name === value ? 'now' : 'todo'} />)}</span>
          : <span className="text-[11.5px] text-(--dim)">{at + 1} of {themes.length}</span>}
      </div>
    </div>
  )
}
