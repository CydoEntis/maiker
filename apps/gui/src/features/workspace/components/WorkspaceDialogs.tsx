import { extensionProjects } from '@/features/extensions/projects'
import { listenMachineUpdateProgress, listSshHosts, machineActivity } from '@/api/machines'
import { DesktopSettings, type MachinesInfo } from '@/features/settings/components/DesktopSettings'
import { CommandPalette } from './CommandPalette'
import { HoverTips } from './HoverTips'
import { ShortcutOverlay } from '@/features/shortcuts/ShortcutOverlay'
import { Onboarding } from '@/features/welcome/Onboarding'
import { markWelcomed } from '@/features/welcome/welcomed'
import { UpdatedNotice } from '@/features/updates/UpdatedNotice'
import { indexRemoteFiles, listRemoteFolder } from '@/api/fileGets'
import { updaterSummary } from '@/features/updates/useUpdater'
import { ServiceBehindNotice } from '@/features/updates/ServiceBehindNotice'
import { useServiceFinishing } from '@/features/updates/serviceUpdateStatus'
import { abilitiesOf } from '../model/agentAbilities'
import { moveRefusal } from '../model/moveToWorktree'
import { NewWorktreeDialog } from '@/features/worktrees/NewWorktreeDialog'
import { GetFileDialog } from './GetFileDialog'
import { SpecialistsDialog } from './SpecialistsDialog'
import { MachineUpdateDialog } from './MachineUpdateDialog'
import { DraftGuardHost } from '@/features/documents/DraftGuardHost'
import { ConfirmHost } from '@/features/confirm/ConfirmDialog'
import { RenameDialog, RenameMachineDialog } from './RenameDialog'
import { RecentSessionsDialog } from './RecentSessionsDialog'
import { ResumeSavedDialog } from './ResumeSavedDialog'
import { machineProjects } from '../model/newSession'
import { resolveStartFolder } from '../model/startFolder'
import { LOCAL_MACHINE } from '@/api/machines'
import { withNickname, writeMachineNicknames } from '@/data/machineNicknames'
import type { SessionView } from '../model/session'
import { sessionTask } from '../model/worktreeName'
import { Keycaps } from '@/features/shortcuts/Keycaps'
import { folderExists } from '../model/startFolder'
import { OpenProjectPalette } from '@/features/open-project/OpenProjectPalette'
import { ADD_MACHINE } from '../useOpenProject'
import { osOfPlatform, paletteMachinesOf } from '@/features/open-project/paletteMachines'
import { projectOfFolder } from '../projectOfFolder'
import { OpenWorktreeDialog } from './OpenWorktreeDialog'
import { useOpenWorktreeDialog } from '../useProjectActions'
import { useWorkspace } from '../workspaceContext'
import { HelpersRequestDialog, SecretDialog } from './OutsideAskDialogs'
import { sendHelpersAnswer } from '../useOutsideAsks'
import { projectOf as projectNameOf, rowTitle } from '../model/sidebar'

/** What opens over or beside the panes: Inspect, the palette, Settings and each dialog. */
export function WorkspaceDialogs() {
  const { signInGitHub, gitHubSignInsEnded, signInAgent, sessionsQuery, mismatch, focusMode, projectOf, shortcutsOpen, platform, root, setShortcutsOpen, welcomeOpen, preferences, setPreferences, setWelcomeOpen, paletteOpen, paletteItems, paletteOutputItem, setPaletteOpen, focusedId, sessionMap, needsElsewhere, setFocusMode, focusModeChord, worktreeFrom, createWorktree, moveToWorktree, setWorktreeFrom, projectWorktreeFrom, setProjectWorktreeFrom, heads, sessions, getFileId, setGetFileId, getFile, updateAsk, setUpdateAsk, updateNamed, pendingConfirm, renamingMachine, machineNicknames, setMachineNicknames, setRenamingMachine, renameId, saveName, setRenameId, settingsSection, setSettingsSection, systemReducedMotion, systemDark, previewThemeSoon, showTestNotice, updater, restartNow, setPreviewTheme, online, runningVersion, machinesKnown, retryNamed, removeNamed, grantNamed, copyCommand, addNamed, openLoginNamed, cancelAdding, reducedMotion, usageInfo, chooseStartFolder, updatedTo, setUpdatedTo, restarting, home, recentOpen, setRecentOpen, reopenSession, savedOpen, setSavedOpen, resumeSaved, canStart, focusedSession, specialistsId, setSpecialistsId, starting, afterAppUpdate, openProject, setOpenProject, openedProjects, sidebarMachineHeads, setNewChatSeed, setNewChatMachine, setNewChatOpen, openAsk, setOpenAsk, paneSessions } = useWorkspace()
  // The session whose request is open, while it still asks: an answer from anywhere closes the dialog with it.
  const asker = openAsk === null ? undefined : paneSessions.get(openAsk.sessionId)
  const askedSecret = openAsk?.kind === 'secret' ? asker?.secretAsk.find((ask) => ask.id === openAsk.askId) : undefined
  const serviceFinishing = useServiceFinishing()
  const openWorktree = useOpenWorktreeDialog()
  // One set of host calls for Settings › Remote machines and the palette's New machine level.
  const machinesInfo: MachinesInfo = { known: machinesKnown, list: heads.filter((head) => head.name !== null), onRetry: retryNamed, onRemove: removeNamed, onGrant: grantNamed, onUpdate: updateNamed, onCheckActivity: machineActivity, onCopyCommand: copyCommand, onOpenLogin: (machine) => { const name = heads.find((head) => head.machine === machine)?.name; if (name) openLoginNamed(machine, name) }, onRename: (name, nickname) => { const next = withNickname(machineNicknames, name, nickname); setMachineNicknames(next); writeMachineNicknames(next) }, sessionsOn: (machine) => sessions.filter((session) => session.machine === machine).length, add: { loadHosts: listSshHosts, onAdd: addNamed, onCancel: cancelAdding, onProgress: listenMachineUpdateProgress, open: () => { setOpenProject(ADD_MACHINE) } } }
  return (
    <>
      {/* A service on another protocol has its own card; this is for one that still talks but runs an older release. */}
      {mismatch === null && <ServiceBehindNotice sessionsQuery={sessionsQuery} restartServiceWhenIdle={preferences.restartServiceWhenIdle} starting={starting} afterAppUpdate={afterAppUpdate} />}
            <HoverTips />
            {shortcutsOpen && <ShortcutOverlay platform={platform} portalContainer={root} onClose={() => { setShortcutsOpen(false) }} />}
            {welcomeOpen && (
              <Onboarding
                reducedMotion={reducedMotion}
                portalContainer={root}
                home={home}
                startFolder={preferences.startFolder}
                validateFolder={folderExists}
                onChooseFolder={chooseStartFolder}
                onApply={({ startFolder, openSessionsIn }) => { setPreferences((current) => ({ ...current, startFolder, openSessionsIn })) }}
                onClose={() => { markWelcomed(); setWelcomeOpen(false) }}
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
                folder={worktreeFrom.repoRoot ?? worktreeFrom.cwd}
                task={sessionTask(worktreeFrom)}
                {...(worktreeFrom.branch === null ? {} : { fromBranch: worktreeFrom.branch })}
                {...(abilitiesOf(worktreeFrom.process).moveToWorktree ? { move: { blocked: moveRefusal(worktreeFrom), run: async (branch: string) => { setWorktreeFrom(null); await moveToWorktree(worktreeFrom, branch) } } } : {})}
                onCreate={(branch, base) => createWorktree(worktreeFrom, branch, base)}
                onCancel={() => { setWorktreeFrom(null) }}
              />
            )}
            {openWorktree && <OpenWorktreeDialog {...openWorktree} />}
            {/* From a project heading: the session only lends its repository, so no name from its task and no move of its chat. */}
            {projectWorktreeFrom && (
              <NewWorktreeDialog
                term={projectWorktreeFrom.pane}
                repoName={projectWorktreeFrom.repoName ?? projectWorktreeFrom.cwdLabel}
                machine={projectWorktreeFrom.machine}
                folder={projectWorktreeFrom.repoRoot ?? projectWorktreeFrom.cwd}
                {...(projectWorktreeFrom.branch === null ? {} : { fromBranch: projectWorktreeFrom.branch })}
                onCreate={async (branch, base) => { await createWorktree(projectWorktreeFrom, branch, base); setProjectWorktreeFrom(null) }}
                onCancel={() => { setProjectWorktreeFrom(null) }}
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
            {asker !== undefined && openAsk?.kind === 'helpers' && asker.helperAsk.length > 0 && (
              <HelpersRequestDialog
                asker={{ name: rowTitle(asker), project: projectNameOf(asker) }}
                tasks={asker.helperAsk}
                online={online}
                onAnswer={(choice) => { setOpenAsk(null); sendHelpersAnswer(asker, choice) }}
                onCancel={() => { setOpenAsk(null) }}
              />
            )}
            {asker !== undefined && askedSecret !== undefined && (
              <SecretDialog key={askedSecret.id} asker={{ name: rowTitle(asker), project: projectNameOf(asker) }} ask={askedSecret} machine={asker.machine} online={online} onDone={() => { setOpenAsk(null) }} />
            )}
            <DraftGuardHost />
            <ConfirmHost pending={pendingConfirm} />
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
            {renameId !== null && sessionMap.get(renameId) && (
              <RenameDialog session={sessionMap.get(renameId) as SessionView} onSave={(name) => { saveName(renameId, name) }} onCancel={() => { setRenameId(null) }} />
            )}
            {openProject !== null && (
              <OpenProjectPalette
                mode="open"
                start={openProject.start}
                machines={paletteMachinesOf(sidebarMachineHeads, resolveStartFolder(preferences.startFolder, home))}
                localOs={osOfPlatform(platform)}
                home={home}
                opened={openedProjects.opened}
                onTake={async ({ machine, folder }) => {
                  if (openProject.purpose === 'session') {
                    setNewChatMachine(machine)
                    setNewChatSeed({ folder, message: '' })
                    setNewChatOpen(true)
                    return
                  }
                  const head = sidebarMachineHeads.find((candidate) => candidate.machine === machine)
                  openedProjects.open(await projectOfFolder(machine, head?.name ?? null, folder))
                }}
                adding={machinesInfo}
                onClose={() => { setOpenProject(null) }}
              />
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
                machines={machinesInfo}
                usage={usageInfo}
                onSignInAgent={signInAgent}
                github={{ onSignIn: signInGitHub, signInsEnded: gitHubSignInsEnded }}
                extensionProjects={extensionProjects(sessions)}
                onChooseFolder={chooseStartFolder}
                onClose={() => { setPreviewTheme(null); setSettingsSection(null) }}
              />
            )}
            {/* Not while the service still runs the older version: the update is not finished, and its card says so. */}
            {updatedTo && !mismatch && <UpdatedNotice update={updatedTo} serviceFinishing={serviceFinishing} onDone={() => { setUpdatedTo(null) }} />}
            {restarting && (
              <div className="mx-restarting" role="status">
                <strong>Restarting Maiker</strong>
                <span>Reopening your layout. Your sessions never stopped.</span>
              </div>
            )}
    </>
  )
}
