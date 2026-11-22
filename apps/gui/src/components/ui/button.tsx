import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/*
 * The design's Button (`Button/kind=…/size=…` in the chat handoff). Diverges from upstream shadcn: the variants are the
 * design's kinds, drawn from the role tokens in `tokens.css`, and the corners come from `--r-control`.
 *   primary  the theme's accent: the one main action on a surface
 *   needs    the needs-you colour: the main answer to something waiting on the person, and nothing else
 *   solid    the text colour as a fill: the one main action of a dialog or a setup step (Continue, Connect, Start a session)
 *   outline  a hairline on nothing: the second answer beside a needs or solid one
 *   soft     a neutral fill of the text colour at 10% with a hairline: every other action beside a primary or needs one. The text colour,
 *            not `--raise`: a raised fill was one shade off a float or a card and did not read as a button there.
 *   ghost    text only until hovered: quiet actions in a header or toolbar
 *   danger   a red word on a soft red tint: an action that ends or removes something
 *   link     an inline text link
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-(--r-control) border whitespace-nowrap font-(family-name:--ui) outline-none select-none transition-[background-color,color,border-color] duration-(--t-fast) ease-(--ease) disabled:cursor-not-allowed disabled:opacity-42 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        primary: "border-(--accent) [--fold-line:var(--accent)] bg-(--accent) font-semibold text-(--on-accent) hover:enabled:bg-[color-mix(in_oklab,var(--accent)_90%,white)] active:enabled:bg-[color-mix(in_oklab,var(--accent)_80%,var(--bg))]",
        needs: "border-(--needs) [--fold-line:var(--needs)] bg-(--needs) font-semibold text-(--on-needs) hover:enabled:bg-[color-mix(in_oklab,var(--needs)_90%,white)] active:enabled:bg-[color-mix(in_oklab,var(--needs)_80%,var(--bg))]",
        solid: "border-(--fg) [--fold-line:var(--fg)] bg-(--fg) font-semibold text-(--bg) hover:enabled:bg-[color-mix(in_oklab,var(--fg)_88%,var(--bg))] active:enabled:bg-[color-mix(in_oklab,var(--fg)_78%,var(--bg))] aria-disabled:cursor-not-allowed aria-disabled:opacity-42",
        outline: "border-(--line2) [--fold-line:var(--line2)] bg-transparent font-normal text-(--fg2) hover:enabled:bg-(--hover) hover:enabled:text-(--fg) active:enabled:bg-(--sel)",
        soft: "border-(--line2) [--fold-line:var(--line2)] bg-[color-mix(in_oklab,var(--fg)_10%,transparent)] font-semibold text-(--fg) hover:enabled:bg-[color-mix(in_oklab,var(--fg)_16%,transparent)] active:enabled:bg-[color-mix(in_oklab,var(--fg)_22%,transparent)] aria-expanded:bg-[color-mix(in_oklab,var(--fg)_16%,transparent)]",
        ghost: "border-transparent bg-transparent font-medium text-(--fg2) hover:enabled:bg-(--hover) hover:enabled:text-(--fg) active:enabled:bg-(--sel) aria-expanded:bg-(--sel)",
        danger: "border-[color-mix(in_oklab,var(--err)_45%,transparent)] [--fold-line:color-mix(in_oklab,var(--err)_45%,transparent)] bg-[color-mix(in_oklab,var(--err)_10%,transparent)] font-semibold text-(--err) hover:enabled:bg-[color-mix(in_oklab,var(--err)_18%,transparent)]",
        link: "h-auto border-transparent px-0 font-medium text-(--link) underline-offset-2 hover:underline",
      },
      size: {
        sm: "h-6 px-2 text-xs",
        md: "h-[30px] px-3 text-[12.5px]",
        /** The footer's quiet buttons (Back, Cancel, Done). */
        lg: "h-[34px] px-3 text-[13px]",
        /** The main action of a dialog's foot. */
        xl: "h-9 px-[18px] text-[13.5px]",
        /** The action beside a field (Connect). */
        field: "h-10 px-[18px] text-[13.5px]",
        /** A round or filled button that holds only a glyph (the chat's jump button, the browser preview). A plain icon button is `IconButton`. */
        icon: "size-7 border-transparent px-0 text-(--muted) hover:enabled:text-(--fg) [&_svg:not([class*='size-'])]:size-[15px]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)

/** The key that presses a button while its card is shown, drawn after the label. */
/** The names `aria-keyshortcuts` takes for the keys a keycap draws as a symbol. */
const KEY_NAME: Readonly<Record<string, string>> = { "⏎": "Enter", "↑": "ArrowUp", "↓": "ArrowDown", "Esc": "Escape" }

function KeyHint({ children }: { children: React.ReactNode }) {
  // The keycap is for the eye; the button's name stays its words, and `aria-keyshortcuts` names the key.
  return <kbd aria-hidden="true" className="rounded-(--r-badge) border border-current px-[5px] py-px font-(family-name:--mono) text-[10.5px] font-medium opacity-70">{children}</kbd>
}

function Button({
  className,
  variant = "primary",
  size = "md",
  asChild = false,
  keyHint,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** The key that also presses it, shown as a small keycap. */
    keyHint?: string | undefined
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      aria-keyshortcuts={keyHint === undefined ? undefined : KEY_NAME[keyHint] ?? keyHint}
      {...props}
    >
      {asChild || keyHint === undefined ? children : <>{children}<KeyHint>{keyHint}</KeyHint></>}
    </Comp>
  )
}

export { Button, KeyHint, buttonVariants }
