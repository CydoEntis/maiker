import { useCallback, useState } from 'react'

/**
 * Which machine the sidebar's + menu is open for (null: closed). The window opens it for Get started, the empty state and the
 * palette's "New session on <machine>", so everything that starts a session goes through the one menu.
 */
export function useStartMenu({ sidebarMode, toggleSidebar }: { sidebarMode: 'rail' | 'docked' | 'hidden'; toggleSidebar: () => void }) {
  const [startMenu, setStartMenu] = useState<number | null>(null)
  const openStartMenu = useCallback((machine: number) => {
    // The menu hangs from the sidebar's +, so a sidebar the user hid comes back to carry it.
    if (sidebarMode === 'hidden') toggleSidebar()
    setStartMenu(machine)
  }, [sidebarMode, toggleSidebar])
  return { startMenu, setStartMenu, openStartMenu }
}
