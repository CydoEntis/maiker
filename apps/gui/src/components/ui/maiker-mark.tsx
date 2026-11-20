import type { CSSProperties } from "react"

/** The mark's drawing box, as the design cuts it, and the size the title bar draws it at. */
const VIEW_BOX = "-3 -1 106 82"
const TITLE_BAR_WIDTH = 18
const TITLE_BAR_HEIGHT = 15
const OUTLINE_WIDTH = 3.6

/** The mark's outlines, shared with the first-run drawing so the logo exists in one place. */
const LEFT_FACE = "M2.9 29.6 24.3 45.6V61.5Q24.3 64 22 65.6L8 74.8Q2.9 77 2.9 71Z"
const RIGHT_RIBBON = "M49.3 26.9 74.5 6Q82.9 0 91 6L94 9Q96.4 12 96.4 16V61Q96.4 64.5 93 66.6L79 75.4Q72 79 72 71V34.1L63.1 41.9Z"
const FOLD_FACE = "M49.3 29 72 8.9V34.1L63.1 41.9Z"
const LEFT_RIBBON = "M2.9 27.4V17.5Q2.9 14 5.5 11.5L9 8.4Q15 3 22 8.2L63.1 41.9 49 54Q45 57.5 40.5 54.5Z"
const MARK_OUTLINES: readonly string[] = [LEFT_FACE, RIGHT_RIBBON, LEFT_RIBBON]

/** Folded faces are the text colour at 70% over the ground, so the mark is white in dark themes and black in light ones. */
const FACE_STYLE: CSSProperties = { fill: "color-mix(in srgb, var(--fg) 70%, var(--bg))" }
const FACE_NO_OUTLINE_STYLE: CSSProperties = { ...FACE_STYLE, stroke: "none" }
const RIBBON_STYLE: CSSProperties = { fill: "var(--fg)" }
const SVG_STYLE: CSSProperties = { flex: "none", display: "block", stroke: "var(--bg)" }

/**
 * The Maiker M in the theme's own colours: ribbons in `--fg`, folded faces 70% `--fg` over `--bg`, outlined in `--bg`.
 * The colours are set through `style`, never SVG attributes, because attributes cannot read the theme's variables.
 */
function MaikerMark({ width = TITLE_BAR_WIDTH, height = TITLE_BAR_HEIGHT }: { width?: number; height?: number }) {
  return (
    <svg role="img" aria-label="Maiker" width={width} height={height} viewBox={VIEW_BOX} style={SVG_STYLE} strokeWidth={OUTLINE_WIDTH} strokeLinejoin="round" data-slot="maiker-mark">
      <path style={FACE_STYLE} d={LEFT_FACE} />
      <path style={RIBBON_STYLE} d={RIGHT_RIBBON} />
      <path style={FACE_NO_OUTLINE_STYLE} d={FOLD_FACE} />
      <path style={RIBBON_STYLE} d={LEFT_RIBBON} />
    </svg>
  )
}

export { MaikerMark, MARK_OUTLINES, VIEW_BOX as MARK_VIEW_BOX }
