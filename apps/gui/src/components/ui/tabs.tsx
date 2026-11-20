import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"
import "./tabs.css"

/**
 * The underlined tabs of a dialog (the design's "Clone from URL / GitHub / On this computer"): a row of words on a hairline,
 * the picked one in the text colour and bold with a 2px rule under it. Radix gives it the roles and the arrow keys; the
 * caller shows what the picked tab holds, so there are no panels here. Use `Segmented` for a choice that is a setting.
 */
function Tabs({ className, ...props }: Omit<React.ComponentProps<typeof TabsPrimitive.Root>, "orientation">) {
  return <TabsPrimitive.Root data-slot="tabs" className={className} {...props} />
}

function TabList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List data-slot="tab-list" className={cn("mx-tabs", className)} {...props} />
}

function Tab({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger data-slot="tab" className={cn("mx-tab", className)} {...props} />
}

export { Tabs, TabList, Tab }
