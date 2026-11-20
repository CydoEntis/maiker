import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { loadAgentAuth } from '@/api/daemon'
import { useShortcutText } from '@/features/shortcuts/platform'
import { UpdateSlot } from '@/features/updates/UpdateSlot'
import { skipUpdate } from '@/features/updates/updateMemory'
import { agentUsages } from '@/features/usage/agentLimits'
import { nowSeconds } from '../model/newChatHost'
import { useWorkspace } from '../workspaceContext'
import { StatusBar } from './StatusBar'

/** How long an agent's plan name is trusted before it is asked for again: a plan changes rarely, and asking runs the agent's own command. */
const MINUTE_MS = 60_000
const PLAN_FRESH_MINUTES = 10
const PLAN_FRESH_MS = PLAN_FRESH_MINUTES * MINUTE_MS

/** The status bar, fed from the window: the running version and its update, the limits the agents last reported, the palette key. */
export function WorkspaceStatusBar() {
  const { sessions, focusedSession, runningVersion, updater, skippedVersion, setSkippedVersion, restartNow, root, setPaletteOpen, setSettingsSection } = useWorkspace()
  const shortcutText = useShortcutText()
  const claudeReports = sessions.some((session) => session.process === 'claude' && session.limits.length > 0)
  // The plan decides which windows bind (Max has no 5-hour one); a failed read leaves the limits as the agent sent them.
  const claudeAuth = useQuery({ queryKey: ['agent-auth', 'claude'], queryFn: () => loadAgentAuth('claude'), enabled: claudeReports, staleTime: PLAN_FRESH_MS, retry: false })
  const claudePlan = claudeAuth.data?.plan ?? ''
  const usages = useMemo(() => agentUsages(sessions, { claude: claudePlan }, nowSeconds()), [sessions, claudePlan])
  return (
    <StatusBar
      version={runningVersion}
      update={(
        <UpdateSlot
          variant="bar"
          state={updater.state}
          version={runningVersion}
          skipped={skippedVersion}
          portalContainer={root}
          onInstall={updater.download}
          onRestartNow={restartNow}
          onCheck={updater.check}
          onSkip={(version) => { skipUpdate(version); setSkippedVersion(version) }}
        />
      )}
      usages={usages}
      currentAgent={focusedSession?.process ?? null}
      commandsKeys={shortcutText('palette')}
      onOpenCommands={() => { setPaletteOpen(true) }}
      onOpenUsage={() => { setSettingsSection('usage') }}
    />
  )
}
