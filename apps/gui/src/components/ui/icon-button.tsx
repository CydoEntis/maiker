import * as React from "react"
import { cn } from "@/lib/utils"

/*
 * The one icon button: a 26px square holding a 14px glyph, in the text colours only. Hover, and a button that is on or
 * has its menu open, take the ink as a fill, so the same rule shows on a pane, the sidebar and a float in every theme.
 * The size and the glyph are fixed here: a caller places the button, it does not resize or colour it.
 */
const ICON_BUTTON =
  "relative inline-flex size-[26px] shrink-0 items-center justify-center rounded-(--r-control) text-(--muted) outline-none select-none " +
  "transition-[background-color,color] duration-(--t-fast) ease-(--ease) " +
  "hover:enabled:bg-(--icon-button-fill) hover:enabled:text-(--fg) " +
  "aria-expanded:bg-(--icon-button-fill) aria-expanded:text-(--fg) aria-pressed:bg-(--icon-button-fill) aria-pressed:text-(--fg) " +
  "data-[on=true]:bg-(--icon-button-fill) data-[on=true]:text-(--fg) " +
  "disabled:cursor-not-allowed disabled:opacity-42 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0"

type IconButtonProps = Omit<React.ComponentProps<"button">, "aria-label" | "title"> & {
  /** What the button does: its accessible name, and its tooltip unless `tip` says more. */
  label: string
  /** The tooltip when it says more than the name (the keys that do the same). */
  tip?: string | undefined
  /** Lit while what it shows is on, for a button that is not a toggle (a filter that narrows the list). */
  on?: boolean | undefined
}

/** A square button with only an icon. `label` is required: an icon alone has no name. */
function IconButton({ label, tip, on, className, ...props }: IconButtonProps) {
  return <button type="button" data-slot="icon-button" data-on={on === true ? true : undefined} aria-label={label} title={tip ?? label} className={cn(ICON_BUTTON, className)} {...props} />
}

export { IconButton }
