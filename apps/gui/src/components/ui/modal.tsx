import type { ReactNode } from "react"
import { X } from "lucide-react"
import { DialogTitle } from "@/components/ui/dialog"
import { IconButton } from "@/components/ui/button"
import "./modal.css"

/**
 * The parts of a modal window (the design's clone and remote-machine windows): a 52px head with the title and a close
 * button, a body that scrolls, and a foot with the secondary action at the left and the main one at the right. The
 * caller puts them inside a `Dialog` frame (`.mx-rename.mx-modal`), so every such window has the same rhythm.
 */
function ModalHead({ title, onClose, closeDisabled = false }: { title: string; onClose: () => void; closeDisabled?: boolean }) {
  return (
    <div className="mx-modal-head">
      <DialogTitle asChild><h2>{title}</h2></DialogTitle>
      <IconButton label="Close" disabled={closeDisabled} onClick={onClose}><X /></IconButton>
    </div>
  )
}

function ModalBody({ children }: { children: ReactNode }) {
  return <div className="mx-modal-body">{children}</div>
}

/** The first child sits at the left, the rest at the right. */
function ModalFoot({ left, children }: { left?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-modal-foot">
      {left}
      <span className="mx-spacer" />
      {children}
    </div>
  )
}

export { ModalHead, ModalBody, ModalFoot }
