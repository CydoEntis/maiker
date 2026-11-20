import type { ReactNode } from 'react'
import type { UsageItem } from '@/features/chat/usageStrip'
import { levelOf, meterTip, usageName } from './meterFacts'
import './usage-meter.css'

const PERCENT = 100
/** The ring, square as the window's corners are: a path round a 12px box, starting at the top middle. */
const METER_PATH = 'M6 1H11V11H1V1H6'
/** The same ring under Rounded corners: a circle from the same start point. */
const METER_ROUND = 'M6 1A5 5 0 1 1 6 11A5 5 0 1 1 6 1'

/** A ring filled to `percent`, in the theme's meter colours. */
export function ContextRing({ percent, label }: { percent: number; label: string }) {
  const fill = `${String(percent)} ${String(PERCENT)}`
  return (
    <svg className="mx-usage-ring" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={PERCENT} aria-valuenow={percent} width="12" height="12" viewBox="0 0 12 12">
      <path d={METER_PATH} className="mx-usage-track mx-usage-sq" />
      <path d={METER_PATH} className="mx-usage-fill mx-usage-sq" pathLength={PERCENT} strokeDasharray={fill} />
      <path d={METER_ROUND} className="mx-usage-track mx-usage-round" />
      <path d={METER_ROUND} className="mx-usage-fill mx-usage-round" pathLength={PERCENT} strokeDasharray={fill} />
    </svg>
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
  className?: string
}

/** One usage meter: a short name, a ring and the figure. The chat box's row and the status bar both draw it. */
export function UsageMeter({ item, onOpen, openLabel = 'Open Usage & cost', graded = false, lead, className = '' }: MeterProps) {
  const level = graded ? levelOf(item.percent) : null
  const tip = meterTip(item)
  const classes = `mx-usage-item is-${item.tone}${level === null ? '' : ` is-${level}`}${className === '' ? '' : ` ${className}`}`
  const body = (
    <>
      {lead}
      <span className="mx-usage-name">{usageName(item)}</span>
      <ContextRing percent={item.percent} label={item.label} />
      <span className="mx-usage-figure">{`${String(item.percent)}%`}</span>
    </>
  )
  return onOpen === undefined
    ? <span className={classes} title={tip}>{body}</span>
    : <button type="button" className={classes} title={`${tip} · ${openLabel}`} onClick={onOpen}>{body}</button>
}

/** A context ring and its figure with no name, for the pane footer. */
export function ContextMeter({ percent }: { percent: number }) {
  return (
    <span className="mx-context-meter" title={`How much of this chat's memory is used: ${String(percent)}%`}>
      <ContextRing percent={percent} label="Context" />
      <span>{`${String(percent)}%`}</span>
    </span>
  )
}
