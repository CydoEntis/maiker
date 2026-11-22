import type { CSSProperties } from "react"

/** The mark's drawing box, as the design cuts it, and the size the title bar draws it at. */
const VIEW_BOX = "-3 -1 106 82"
const TITLE_BAR_WIDTH = 18
const TITLE_BAR_HEIGHT = 14

/** The mark's outlines, shared with the first-run drawing so the logo exists in one place. */
const LEFT_FACE = "M2.9 29.6 24.3 45.6V61.5Q24.3 64 22 65.6L8 74.8Q2.9 77 2.9 71Z"
const RIGHT_RIBBON = "M49.3 26.9 74.5 6Q82.9 0 91 6L94 9Q96.4 12 96.4 16V61Q96.4 64.5 93 66.6L79 75.4Q72 79 72 71V34.1L63.1 41.9Z"
const LEFT_RIBBON = "M2.9 27.4V17.5Q2.9 14 5.5 11.5L9 8.4Q15 3 22 8.2L63.1 41.9 49 54Q45 57.5 40.5 54.5Z"
const MARK_OUTLINES: readonly string[] = [LEFT_FACE, RIGHT_RIBBON, LEFT_RIBBON]

/** The folded face is the same ink at half strength, so the mark needs no second colour on any theme. */
const FACE_STYLE: CSSProperties = { opacity: 0.5 }
const SVG_STYLE: CSSProperties = { flex: "none", display: "block" }

type Props = {
  width?: number
  height?: number
  /** Beside the written name the mark says nothing more, so a screen reader skips it. */
  decorative?: boolean
}

/**
 * The Maiker M in one ink: the text colour of whatever it sits in (`currentColor`), with the folded face at half
 * strength. It takes no colour of its own, so it is right on every theme and dims with the words beside it.
 */
function MaikerMark({ width = TITLE_BAR_WIDTH, height = TITLE_BAR_HEIGHT, decorative = false }: Props) {
  const naming = decorative ? { "aria-hidden": true } : { role: "img", "aria-label": "Maiker" }
  return (
    <svg {...naming} width={width} height={height} viewBox={VIEW_BOX} style={SVG_STYLE} fill="currentColor" data-slot="maiker-mark">
      <path style={FACE_STYLE} d={LEFT_FACE} />
      <path d={RIGHT_RIBBON} />
      <path d={LEFT_RIBBON} />
    </svg>
  )
}

export { MaikerMark, MARK_OUTLINES, VIEW_BOX as MARK_VIEW_BOX }
