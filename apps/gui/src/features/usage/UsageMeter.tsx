import type { ReactNode } from 'react'
import type { UsageItem } from '@/features/chat/usageStrip'
import { levelOf, meterTip, usageName } from './meterFacts'
import './usage-meter.css'

const PERCENT = 100
/** The ring: a circle in a 12px box, starting at the top middle. */
const METER_RING = 'M6 1A5 5 0 1 1 6 11A5 5 0 1 1 6 1'

/** A ring filled to `percent`, in the theme's meter colours. */
export function ContextRing({ percent, label }: { percent: number; label: string }) {
  const fill = `${String(percent)} ${String(PERCENT)}`
  return (
    <svg className="mx-usage-ring" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={PERCENT} aria-valuenow={percent} width="12" height="12" viewBox="0 0 12 12">
      <path d={METER_RING} className="mx-usage-track" />
      <path d={METER_RING} className="mx-usage-fill" pathLength={PERCENT} strokeDasharray={fill} />
    </svg>
  )
}

/** A thin bar filled to `percent`: the status bar's and the pane footer's shape of the same meter. */
export function MeterBar({ percent, label }: { percent: number; label: string }) {
  return (
    <span className="mx-usage-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={PERCENT} aria-valuenow={percent}>
      <i style={{ width: `${String(percent)}%` }} />
    </span>
  )
}

type MeterProps = {
  item: UsageItem
  /** Present: the meter is a button that does this. */
  onOpen?: (() => void) | undefined
  /** What the click does, said in the tooltip after the figures. */
  openLabel?: string
  /** Colour the meter by how near its limit it is (`levelOf`); off, it stays neutral. */
  graded?: boolean
  /** Shown before the name, such as an agent's mark. */
  lead?: ReactNode
  /** Draw a thin bar where the ring would be. */
  bar?: boolean
  className?: string
}

/** One usage meter: a short name, a ring or bar and the figure. The chat box's row and the status bar both draw it. */
export function UsageMeter({ item, onOpen, openLabel = 'Open Usage & cost', graded = false, lead, bar = false, className = '' }: MeterProps) {
  const level = graded ? levelOf(item.percent) : null
  const tip = meterTip(item)
  const classes = `mx-usage-item is-${item.tone}${item.window === null ? ' is-context' : ''}${level === null ? '' : ` is-${level}`}${className === '' ? '' : ` ${className}`}`
  const body = (
    <>
      {lead}
      <span className="mx-usage-name">{usageName(item)}</span>
      {bar ? <MeterBar percent={item.percent} label={item.label} /> : <ContextRing percent={item.percent} label={item.label} />}
      <span className="mx-usage-figure">{`${String(item.percent)}%`}</span>
    </>
  )
  return onOpen === undefined
    ? <span className={classes} title={tip}>{body}</span>
    : <button type="button" className={classes} title={`${tip} · ${openLabel}`} onClick={onOpen}>{body}</button>
}

/** The pane footer's context meter: the word, a bar and the figure, graded like a limit. */
export function ContextMeter({ percent }: { percent: number }) {
  const level = levelOf(percent)
  return (
    <span className={`mx-context-meter${level === null ? '' : ` is-${level}`}`} title={`How much of this chat's memory is used: ${String(percent)}%`}>
      <span className="mx-usage-name">context</span>
      <MeterBar percent={percent} label="Context" />
      <span className="mx-usage-figure">{`${String(percent)}%`}</span>
    </span>
  )
}
