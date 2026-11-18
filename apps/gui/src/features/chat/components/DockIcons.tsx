import type { ReactNode } from 'react'

/** The few glyphs the dock draws, in the design's stroke: 24-unit box, round caps, currentColor. */
function Glyph({ size, width, children }: { size: number; width: number; children: ReactNode }) {
  return (
    <svg className="mx-dock-glyph" aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

const BADGE_SIZE = 13
const TOOL_SIZE = 12
const CHEVRON_SIZE = 11

export function ClockGlyph() {
  return <Glyph size={BADGE_SIZE} width={2}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></Glyph>
}

/** Points up; the dock rotates it a half turn when its list is open (`is-open`). */
export function ChevronGlyph() {
  return <Glyph size={CHEVRON_SIZE} width={2.4}><path d="m6 15 6-6 6 6" /></Glyph>
}

export function EditGlyph() {
  return <Glyph size={TOOL_SIZE} width={2.1}><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /></Glyph>
}

export function SendNowGlyph() {
  return <Glyph size={TOOL_SIZE} width={2.1}><path d="M12 19V5M6 11l6-6 6 6" /></Glyph>
}

export function MoveUpGlyph() {
  return <Glyph size={TOOL_SIZE} width={2.1}><path d="m6 14 6-6 6 6" /></Glyph>
}

export function RemoveGlyph() {
  return <Glyph size={TOOL_SIZE} width={2.1}><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" /></Glyph>
}

export function HelpersGlyph() {
  return <Glyph size={BADGE_SIZE} width={2}><path d="M5 12h4M12 5v4M12 15v4M15 12h4" /><circle cx="12" cy="12" r="2" /></Glyph>
}
