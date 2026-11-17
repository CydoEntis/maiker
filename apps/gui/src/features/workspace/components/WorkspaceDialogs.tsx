import { ticketProjects } from '@/features/tickets/model/ticketProjects'
import { listSshHosts, machineActivity } from '@/api/machines'
import { DesktopSettings } from '@/features/settings/components/DesktopSettings'
import { PerfOverlay } from './PerfOverlay'
import { CommandPalette } from './CommandPalette'
import { HoverTips } from './HoverTips'
import { ShortcutOverlay } from '@/features/shortcuts/ShortcutOverlay'
import { WelcomeDialog } from '@/features/welcome/WelcomeDialog'
import { markWelcomed } from '@/features/welcome/welcomed'
import { UpdatedNotice } from '@/features/updates/UpdatedNotice'
import { indexRemoteFiles, listRemoteFolder } from '@/api/fileGets'
import { updaterSummary } from '@/features/updates/useUpdater'
import { ServiceBehindNotice } from '@/features/updates/ServiceBehindNotice'
import { useServiceFinishing } from '@/features/updates/serviceUpdateStatus'
import { NewWorktreeDialog } from '@/features/worktrees/NewWorktreeDialog'
import { GetFileDialog } from './GetFileDialog'
import { SpecialistsDialog } from './SpecialistsDialog'
import { MachineUpdateDialog } from './MachineUpdateDialog'
import { ConfirmCloseDialog } from './ConfirmCloseDialog'
import { RenameDialog, RenameMachineDialog } from './RenameDialog'
import { RecentSessionsDialog } from './RecentSessionsDialog'
import { ResumeSavedDialog } from './ResumeSavedDialog'
import { machineProjects } from '../model/newSession'
import { resolveStartFolder } from '../model/startFolder'
import { LOCAL_MACHINE } from '@/api/machines'
import { withNickname, writeMachineNicknames } from '@/data/machineNicknames'
import { Toast } from './states'
import type { SessionView } from '../model/session'
import { Keycaps } from '@/features/shortcuts/Keycaps'
import { folderExists } from '../model/startFolder'
import { useWorkspace } from '../workspaceContext'

/** What opens over or beside the panes: Inspect, the palette, Settings and each dialog. */
export function WorkspaceDialogs() {
  const { signInGitHub, gitHubSignInsEnded, signInAgent, sessionsQuery, mismatch, focusMode, projectOf, shortcutsOpen, platform, root, setShortcutsOpen, welcomeOpen, preferences, setPreferences, setWelcomeOpen, newSession, focusedMachineNumber, paletteOpen, paletteItems, paletteOutputItem, setPaletteOpen, focusedId, sessionMap, needsElsewhere, setFocusMode, focusModeChord, worktreeFrom, createWorktree, setWorktreeFrom, heads, sessions, getFileId, setGetFileId, getFile, updateAsk, setUpdateAsk, updateNamed, closeAsk, setCloseAsk, renamingMachine, machineNicknames, setMachineNicknames, setRenamingMachine, renameId, renameInline, saveName, setRenameId, settingsSection, setSettingsSection, systemReducedMotion, systemDark, previewThemeSoon, showTestNotice, updater, restartNow, setPreviewTheme, online, runningVersion, machinesKnown, retryNamed, removeNamed, grantNamed, copyCommand, addNamed, cancelAdding, usageInfo, chooseStartFolder, toastMessage, updatedTo, setUpdatedTo, restarting, home, recentOpen, setRecentOpen, reopenSession, savedOpen, setSavedOpen, resumeSaved, canStart, focusedSession, specialistsId, setSpecialistsId, afterAppUpdate } = useWorkspace()
  const serviceFinishing = useServiceFinishing()
  return (
    <>
      {/* A service on another protocol has its own card; this is for one that still talks but runs an older release. */}
      {mismatch === null && <ServiceBehindNotice sessionsQuery={sessionsQuery} restartWhenIdle={preferences.restartWhenIdle} afterAppUpdate={afterAppUpdate} />}
            <HoverTips />
            {shortcutsOpen && <ShortcutOverlay platform={platform} portalContainer={root} onClose={() => { setShortcutsOpen(false) }} />}
            {welcomeOpen && (
              <WelcomeDialog
                platform={platform}
                startFolder={preferences.startFolder}
                portalContainer={root}
                validateFolder={folderExists}
                onStartFolder={(path) => { setPreferences((current) => ({ ...current, startFolder: path })) }}
                onClose={() => { markWelcomed(); setWelcomeOpen(false) }}
                onStartSession={() => { newSession(focusedMachineNumber) }}
              />
            )}
            {paletteOpen && <CommandPalette items={paletteItems} outputItem={paletteOutputItem} onClose={() => { setPaletteOpen(false) }} />}
            {focusMode && (
              <div className="mx-focus-pill" role="status">
                <span className="mx-focus-tag">Focus</span>
                {focusedId && sessionMap.get(focusedId) && <span>{projectOf.get(focusedId)?.name} · {sessionMap.get(focusedId)?.cwdLabel} · {sessionMap.get(focusedId)?.process}</span>}
                <span className={needsElsewhere > 0 ? 'mx-focus-needs' : undefined}>{needsElsewhere > 0 ? `${String(needsElsewhere)} need you elsewhere` : 'Nothing else needs you'}</span>
                <button type="button" className="mx-focus-exit" onClick={() => { setFocusMode(false) }}>Exit <Keycaps chord={focusModeChord} /></button>
              </div>
            )}
            {worktreeFrom && (
              <NewWorktreeDialog
                term={worktreeFrom.pane}
                repoName={worktreeFrom.repoName ?? worktreeFrom.cwdLabel}
                machine={worktreeFrom.machine}
                onCreate={(branch, base) => createWorktree(worktreeFrom, branch, base)}
                onCancel={() => { setWorktreeFrom(null) }}
              />
            )}
            {getFileId !== null && sessionMap.get(getFileId)?.machineName != null && (
              <GetFileDialog
                session={sessionMap.get(getFileId) as SessionView}
                browse={{
                  list: (path) => listRemoteFolder(sessionMap.get(getFileId)?.machineName ?? '', path),
                  index: (folder) => indexRemoteFiles(sessionMap.get(getFileId)?.machineName ?? '', folder),
                }}
                onGet={(path) => {
                  const target = sessionMap.get(getFileId)
                  setGetFileId(null)
                  if (target?.machineName != null) getFile(target.machineName, path)
                }}
                onCancel={() => { setGetFileId(null) }}
              />
            )}
            {specialistsId !== null && sessionMap.get(specialistsId) !== undefined && (
              <SpecialistsDialog
                title={(sessionMap.get(specialistsId) as SessionView).cwdLabel}
                term={(sessionMap.get(specialistsId) as SessionView).pane}
                onClose={() => { setSpecialistsId(null) }}
              />
            )}
            {updateAsk !== null && (
              <MachineUpdateDialog
                name={updateAsk.name}
                action={updateAsk.action}
                checkActivity={machineActivity}
                onUpdate={(whenIdle) => { setUpdateAsk(null); void updateNamed(updateAsk.name, updateAsk.action, whenIdle) }}
                onCancel={() => { setUpdateAsk(null) }}
              />
            )}
            {closeAsk && (
              <ConfirmCloseDialog title={closeAsk.title} body={closeAsk.body} confirmLabel={closeAsk.confirmLabel} onCancel={() => { setCloseAsk(null) }} onConfirm={() => { const run = closeAsk.run; setCloseAsk(null); run() }} />
            )}
            {renamingMachine !== null && (
              <RenameMachineDialog
                machine={renamingMachine}
                nickname={machineNicknames[renamingMachine.toLowerCase()] ?? ''}
                onSave={(nickname) => {
                  const next = withNickname(machineNicknames, renamingMachine, nickname)
                  setMachineNicknames(next)
                  writeMachineNicknames(next)
                  setRenamingMachine(null)
                }}
                onCancel={() => { setRenamingMachine(null) }}
              />
            )}
            {savedOpen && (
              <ResumeSavedDialog projects={machineProjects(sessions, LOCAL_MACHINE, focusedSession, resolveStartFolder(preferences.startFolder, home))} defaultAgent={preferences.defaultAgent === 'codex' ? 'codex' : 'claude'}
                locked={!canStart} onPick={resumeSaved} onCancel={() => { setSavedOpen(false) }} />
            )}
            {recentOpen && <RecentSessionsDialog home={home} onPick={reopenSession} onReopened={() => { setRecentOpen(false) }} onCancel={() => { setRecentOpen(false) }} />}
            {renameId !== null && !renameInline && sessionMap.get(renameId) && (
              <RenameDialog session={sessionMap.get(renameId) as SessionView} onSave={(name) => { saveName(renameId, name) }} onCancel={() => { setRenameId(null) }} />
            )}
            {settingsSection && (
              <DesktopSettings
                section={settingsSection}
                onSection={setSettingsSection}
                preferences={preferences}
                onChange={setPreferences}
                systemReducedMotion={systemReducedMotion}
                systemDark={systemDark}
                onPreviewTheme={previewThemeSoon}
                onTestNotice={showTestNotice}
                updates={{ summary: updaterSummary(updater.state), status: updater.state.status, version: 'version' in updater.state ? updater.state.version : undefined, download: updater.state.status === 'downloading' ? { progress: updater.state.progress, transfer: updater.state.transfer } : undefined, onCheck: updater.check, onDownload: updater.download, onRestart: restartNow }}
                onShowWelcome={() => { setPreviewTheme(null); setSettingsSection(null); setWelcomeOpen(true) }}
                platform={platform}
                daemon={{ online, sessionCount: sessions.length }}
                appVersion={runningVersion}
                machines={{ known: machinesKnown, list: heads.filter((head) => head.name !== null), onRetry: retryNamed, onRemove: removeNamed, onGrant: grantNamed, onUpdate: updateNamed, onCheckActivity: machineActivity, onCopyCommand: copyCommand, sessionsOn: (machine) => sessions.filter((session) => session.machine === machine).length, add: { windows: navigator.userAgent.includes('Windows'), loadHosts: listSshHosts, onAdd: addNamed, onCancel: cancelAdding } }}
                usage={usageInfo}
                onSignInAgent={signInAgent}
                github={{ onSignIn: signInGitHub, signInsEnded: gitHubSignInsEnded }}
                ticketProjects={ticketProjects(sessions)}
                onChooseFolder={chooseStartFolder}
                onClose={() => { setPreviewTheme(null); setSettingsSection(null) }}
              />
            )}
            {toastMessage && <Toast key={toastMessage.key} message={toastMessage.text} />}
            {/* Not while the service still runs the older version: the update is not finished, and its card says so. */}
            {updatedTo && !mismatch && <UpdatedNotice update={updatedTo} serviceFinishing={serviceFinishing} onDone={() => { setUpdatedTo(null) }} />}
            {preferences.perfOverlay && <PerfOverlay />}
            {restarting && (
              <div className="mx-restarting" role="status">
                <strong>Restarting Maitty</strong>
                <span>Reopening your layout. Your sessions never stopped.</span>
              </div>
            )}
    </>
  )
}
