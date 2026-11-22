import type { ReactNode } from 'react'
import type { UsageItem } from '@/features/chat/usageStrip'
import { levelOf, meterTip, usageName } from './meterFacts'
import './usage-meter.css'

const PERCENT = 100
/** A thin bar filled to `percent`: the one shape of every meter, the context's included. There is no ring. */
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
  className?: string
}

/** One usage meter: a short name, a bar and the figure. The chat box's row and the status bar both draw it. */
export function UsageMeter({ item, onOpen, openLabel = 'Open Usage & cost', graded = false, lead, className = '' }: MeterProps) {
  const level = graded ? levelOf(item.percent) : null
  const tip = meterTip(item)
  const classes = `mx-usage-item is-${item.tone}${item.window === null ? ' is-context' : ''}${level === null ? '' : ` is-${level}`}${className === '' ? '' : ` ${className}`}`
  const body = (
    <>
      {lead}
      <span className="mx-usage-name">{usageName(item)}</span>
      <MeterBar percent={item.percent} label={item.label} />
      <span className="mx-usage-figure">{`${String(item.percent)}%`}</span>
    </>
  )
  return onOpen === undefined
    ? <span className={classes} title={tip}>{body}</span>
    : <button type="button" className={classes} title={`${tip} · ${openLabel}`} onClick={onOpen}>{body}</button>
}

/** A terminal pane header's context meter: a short bar and the figure, graded like a limit. */
export function ContextMeter({ percent }: { percent: number }) {
  const level = levelOf(percent)
  return (
    <span className={`mx-context-meter${level === null ? '' : ` is-${level}`}`} title={`Context window used: ${String(percent)}%`}>
      <MeterBar percent={percent} label="Context" />
      <span className="mx-usage-figure">{`${String(percent)}%`}</span>
    </span>
  )
}
