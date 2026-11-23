import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

/** A question that must be answered before going on (close this session?). Radix gives it the modal, the focus trap and Esc to cancel. */
function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

/** How many questions are on screen. Kept here because every one of them is drawn by `AlertDialogContent`. */
let questionsOpen = 0

/**
 * Whether a question is waiting for its answer. The window's own key handlers ask this first and stand down: until the
 * question is answered, a key belongs to it and must not close a pane or open the palette behind it.
 */
function isAlertDialogOpen(): boolean {
  return questionsOpen > 0
}

/** `onDismiss` runs when the pointer goes down on the veil around the question, for a question that a click outside cancels. */
function AlertDialogContent({ className, container, onDismiss, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Content> & { container?: HTMLElement | null; onDismiss?: (() => void) | undefined }) {
  React.useEffect(() => {
    questionsOpen += 1
    return () => { questionsOpen -= 1 }
  }, [])
  // The question is unmounted by its owner to close it, so Radix has no trigger to give focus back to: the element
  // that had focus when it opened gets it again when it goes.
  const [opener] = React.useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  React.useEffect(() => () => { if (opener?.isConnected === true) opener.focus() }, [opener])
  return (
    // Inside the window's root, never the page's body: the theme's colours, corners and the dialog's float are set on
    // `.mx-app`, and a question drawn outside it is bare text on the terminal.
    <AlertDialogPrimitive.Portal container={container ?? document.querySelector<HTMLElement>('.mx-app')}>
      <AlertDialogPrimitive.Overlay data-slot="alert-dialog-overlay" className="mx-settings-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onDismiss?.() }}>
        <AlertDialogPrimitive.Content data-slot="alert-dialog-content" className={cn("mx-rename", className)} {...props} />
      </AlertDialogPrimitive.Overlay>
    </AlertDialogPrimitive.Portal>
  )
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return <AlertDialogPrimitive.Title data-slot="alert-dialog-title" className={className} {...props} />
}

function AlertDialogDescription({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return <AlertDialogPrimitive.Description data-slot="alert-dialog-description" className={className} {...props} />
}

function AlertDialogAction(props: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return <AlertDialogPrimitive.Action data-slot="alert-dialog-action" {...props} />
}

function AlertDialogCancel(props: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return <AlertDialogPrimitive.Cancel data-slot="alert-dialog-cancel" {...props} />
}

export { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle, isAlertDialogOpen }
