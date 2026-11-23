import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

/** The on/off switch. Radix gives it the keyboard (Space, Enter) and its state; its look is `.mx-switch` in `workspace.css`. */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root data-slot="switch" className={cn("mx-switch", className)} {...props}>
      <SwitchPrimitive.Thumb data-slot="switch-thumb" className="mx-switch-knob" />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
