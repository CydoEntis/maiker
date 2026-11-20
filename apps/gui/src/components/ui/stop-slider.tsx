import * as React from "react"
import { useRef } from "react"
import { cn } from "@/lib/utils"
import "./stop-slider.css"

export type Stop = { readonly value: string; readonly label: string }

type StopSliderProps = Omit<React.ComponentProps<"div">, "onChange" | "role"> & {
  /** The stops, left to right. How many there are comes from the caller's data. */
  stops: readonly Stop[]
  /** The picked stop's value; null while none is picked. */
  value: string | null
  /** Runs on a click on any stop, the picked one too (so a caller may treat that as letting go), and on a key that moves to another stop. */
  onValueChange: (value: string) => void
  /** What a screen reader hears while nothing is picked. */
  emptyText?: string
  disabled?: boolean
}

const STEP_KEYS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1 }

/**
 * N labelled stops on a line (a model's effort, say): click a dot or its word, or press Left and Right. One tab stop,
 * announced as a slider with the picked word as its value. It handles the keys it uses itself, so a menu or popover
 * around it does not move its own focus or close.
 */
function StopSlider({ stops, value, onValueChange, emptyText = "Not picked", disabled = false, className, style, ...props }: StopSliderProps) {
  const index = stops.findIndex((stop) => stop.value === value)
  const pick = (stop: Stop | undefined) => { if (stop !== undefined && !disabled) onValueChange(stop.value) }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = STEP_KEYS[event.key]
    if (step === undefined || disabled) return
    event.preventDefault()
    event.stopPropagation()
    // From nothing picked, Right lands on the first stop and Left on the last.
    const from = index >= 0 ? index : step > 0 ? -1 : stops.length
    const next = Math.min(stops.length - 1, Math.max(0, from + step))
    // Pressing past an end stays put, and must not read as a second press on the picked stop.
    if (next !== index) pick(stops[next])
  }
  // Dragging along the track moves the thumb to the stop under the pointer, live. A plain press is left to the stop's own click.
  const dragging = useRef(false)
  const stopAt = (event: React.PointerEvent<HTMLDivElement>): number => {
    const box = event.currentTarget.getBoundingClientRect()
    return box.width === 0 ? -1 : Math.min(stops.length - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * stops.length)))
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || disabled) return
    const at = stopAt(event)
    if (at >= 0 && at !== index) pick(stops[at])
  }
  return (
    <div
      {...props}
      onPointerDown={(event) => { dragging.current = event.button === 0 }}
      onPointerMove={onPointerMove}
      onPointerUp={() => { dragging.current = false }}
      onPointerCancel={() => { dragging.current = false }}
      data-slot="stop-slider"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, stops.length - 1)}
      aria-valuenow={index >= 0 ? index : undefined}
      aria-valuetext={index >= 0 ? stops[index]?.label : emptyText}
      className={cn("mx-stops", disabled && "is-disabled", className)}
      style={{ ...style, "--stops": stops.length, "--fill": index > 0 ? index / (stops.length - 1) : 0 } as React.CSSProperties}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden="true" className="mx-stops-line" />
      <span aria-hidden="true" className="mx-stops-fill" />
      {stops.map((stop, place) => (
        // Not focusable and hidden from assistive tech: the slider above is the one control, and the keys reach it.
        <button key={stop.value} type="button" tabIndex={-1} aria-hidden="true" className={cn("mx-stop", place <= index && "is-reached", place === index && "is-picked")} onClick={(event) => { event.stopPropagation(); pick(stop) }}>
          <span className="mx-stop-dot" />
          <span className="mx-stop-word">{stop.label}</span>
        </button>
      ))}
    </div>
  )
}

export { StopSlider }
