import { useEffect } from 'react'
import { rememberGround } from '@/data/bootGround'
import { APP_NAME } from '@/brand'
import { Toaster } from '@/components/ui/toaster'
import { KeyOverridesContext } from '@/features/shortcuts/platform'
import { ReducedMotionContext } from './components/motion'
import { useWorkspaceState } from './useWorkspaceState'
import { WorkspaceContext } from './workspaceContext'
import { WorkspaceSidebars } from './components/WorkspaceSidebars'
import { WorkspaceMain } from './components/WorkspaceMain'
import { WorkspaceDialogs } from './components/WorkspaceDialogs'
import { AppTitleBar } from './components/AppTitleBar'
import { WorkspaceSidePanel } from './components/WorkspaceSidePanel'
import { WindowServiceStatus } from './components/WindowServiceStatus'
import { useCloseGuard } from './useCloseGuard'
import './workspace.css'
import './components/sidebar.css'
import './components/pane.css'
import './components/menu.css'
import './components/dialogs.css'
import './components/session-dialogs.css'
import './components/frame.css'
import '@/features/chat/chat.css'

export function DesktopApp() {
  const workspace = useWorkspaceState()
  const { reducedMotion, setRoot, narrow, rootStyle, theme, preferences, machineSaid } = workspace
  // The next start opens on this theme's ground, not a flash of another colour.
  useEffect(() => { rememberGround(theme.tokens.bg) }, [theme.tokens.bg])
  useCloseGuard()
  return (
    <WorkspaceContext.Provider value={workspace}>
    <ReducedMotionContext.Provider value={reducedMotion}>
    <KeyOverridesContext.Provider value={preferences.keyOverrides}>
        <div ref={setRoot} className={`mx-app${narrow ? ' is-narrow' : ''}`} style={rootStyle} data-motion={reducedMotion ? 'reduced' : 'full'} data-theme-kind={theme.light ? 'light' : 'dark'} data-side={preferences.sidebarSide}>
          <AppTitleBar />
          <div className="mx-window" role="application" aria-label={APP_NAME}>
            <WorkspaceSidebars />
            <WorkspaceMain />
            <WorkspaceSidePanel />
            <WorkspaceDialogs />
            <WindowServiceStatus />
          </div>
          <Toaster />
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{machineSaid}</div>
        </div>
    </KeyOverridesContext.Provider>
    </ReducedMotionContext.Provider>
    </WorkspaceContext.Provider>
  )
}
