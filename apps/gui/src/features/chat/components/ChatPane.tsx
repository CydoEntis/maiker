import { MessageSquare } from 'lucide-react'
import { noChatReason, type ChatAvailability } from '@/features/workspace/model/chatView'
import { Button } from '@/components/ui/button'
import type { OpenFile } from '../openFile'
import type { ChatItemContext } from './ChatItems'
import type { PermissionAsk } from '@/data/preview'
import type { SessionStatus } from '@/features/workspace/model/session'
import type { PaneQueue } from '../useChatComposer'
import type { SubagentView } from '@/features/workspace/model/subagents'
import { ChatSession, type WindowActions } from './ChatSession'
import type { HelperAsk } from './QuestionTray'
import type { SessionPlace } from './SessionBar'
import type { EndedActions } from './Composer'
import type { SessionUsage } from '../usageStrip'
import type { ChatProblem } from '../problem'
import { StartingChat } from './StartingChat'
import type { RewindPlace } from '../editFromHere'
import type { FileSearchPlace } from '../fileMention'

export type ChatPaneProps = {
  availability: ChatAvailability
  /** The session's folder, so file names read relative to it. */
  root?: string | null
  /** Shows a file's diff, or a turn's, in the Changes panel. */
  onOpenDiff?: ChatItemContext['openDiff']
  /** Opens a file a reply names, at its line when it gave one. */
  onOpenFile?: OpenFile | null
  /** Types into the terminal the agent runs in, so a chat that follows it can talk to it (ADR 0003). */
  typeInto?: ((text: string) => Promise<void>) | undefined
  /** What the pane's daemon holds for its working agent, and the ways to add to it and take one back. */
  paneQueue?: PaneQueue | undefined
  /** What the daemon read off the screen of a pane that is stopped on a question: the text and its choices. */
  asking?: string
  /** The permission prompt the agent's hook says the pane is stopped on. */
  ask?: PermissionAsk | null
  /** The helpers the session waits on the person to allow (`ChatSession`). */
  helperAsk?: HelperAsk | undefined
  /** The session's id, so what is typed before its agent is ready is kept for it. */
  sessionId?: string
  /** The pane's live status, from the sidebar's source. */
  paneStatus?: SessionStatus
  /** Whether the agent's hooks have reported in, so a chat that never starts can say whether it is the hooks or something after them. */
  hooked?: boolean
  /** Why the agent's hooks never report, with the settings file involved. */
  hookProblem?: { file: string; why: string; repaired: boolean } | null
  /** Helpers keeping the session working after the agent's own turn ended (`Session.helpersOnly`). */
  helpersOnly?: number
  /** What runs in the pane: the agent, or the shell's own name. */
  process: string
  /** The computer is connected to the daemon; starting an agent types into the shell. */
  online: boolean
  /** Shows the session's terminal log over this chat for a moment, without changing the app's view; absent for a chat session, which has none. */
  onShowLog: () => void
  /** False for a chat session (ADR 0003): the agent has no terminal, so nothing here points to one. */
  hasTerminal?: boolean
  /** What the session's agent reported using (context, plan limits), for the strip under the message box. */
  usage?: SessionUsage | undefined
  /** A subagent whose own chat shows instead of the session's, and the way back. */
  subagent?: SubagentView | null
  /** What the runtime lists the session's helpers as doing, for the helpers line above the message box. */
  subagents?: readonly SubagentView[]
  onBackToMain?: () => void
  /** What is wrong with the chat, for the banner over its message box. */
  problem?: ChatProblem | null
  /** The effort the agent's own files say it runs at. */
  effort?: string | null | undefined
  /** Where a sent message's Edit from here restores the files from. */
  rewind?: RewindPlace | undefined
  /** Where an `@` in the message box looks for files. */
  fileSearch?: FileSearchPlace | undefined
  /** Leaves out runs of reads and searches that succeeded (the desktop setting). */
  hideSuccessfulTools?: boolean
  /** The window's screens a command opens instead of Claude Code's menu. */
  windowActions?: WindowActions | undefined
  /** The pane is in a tab kept out of sight: its chat stays mounted but reads nothing. */
  paused?: boolean
  /** Where the session runs, for the row under the message box. */
  place?: SessionPlace | undefined
  /** Set once the session has ended: the message box gives way to a read-only line with Resume and New session here. */
  ended?: EndedActions | undefined
}

/**
 * The chat card of a pane. It covers the pane's terminal, which stays mounted underneath, so
 * opening and closing it never touches the session (v18 B.3).
 */
export function ChatPane(props: ChatPaneProps) {
  const { availability } = props
  return (
    <section className="mx-chat-layer" aria-label="Chat">
      {availability.kind === 'ready'
        ? (
          <ChatSession
            key={availability.link.conversation}
            link={availability.link}
            agent={availability.agent}
            online={props.online}
            paused={props.paused ?? false}
            root={props.root ?? null}
            onOpenDiff={props.onOpenDiff ?? null}
            onOpenFile={props.onOpenFile ?? null}
            typeInto={props.typeInto}
            paneQueue={props.paneQueue}
            ask={props.ask ?? null}
            asking={props.asking ?? ''}
            helperAsk={props.helperAsk}
            subagent={props.subagent ?? null}
            {...(props.subagents === undefined ? {} : { subagents: props.subagents })}
            {...(props.usage === undefined ? {} : { usage: props.usage })}
            {...(props.hasTerminal === false ? {} : { onShowTerminal: props.onShowLog })}
            {...(props.onBackToMain === undefined ? {} : { onBackToMain: props.onBackToMain })}
            problem={props.problem ?? null}
            place={props.place}
            ended={props.ended}
            effort={props.effort ?? null}
            hideSuccessfulTools={props.hideSuccessfulTools ?? false}
            {...(props.rewind === undefined ? {} : { rewind: props.rewind })}
            {...(props.fileSearch === undefined ? {} : { fileSearch: props.fileSearch })}
            {...(props.sessionId === undefined ? {} : { sessionId: props.sessionId })}
            {...(props.paneStatus === undefined ? {} : { paneStatus: props.paneStatus })}
            {...(props.helpersOnly === undefined ? {} : { helpersOnly: props.helpersOnly })}
            {...(props.windowActions === undefined ? {} : { windowActions: props.windowActions })}
          />
        )
        : availability.kind === 'no-events' && props.sessionId !== undefined
          ? <StartingChat agent={availability.agent} sessionId={props.sessionId} onShowLog={props.onShowLog} {...(props.hooked === undefined ? {} : { hooked: props.hooked })} hookProblem={props.hookProblem ?? null} {...(props.paneStatus === undefined ? {} : { paneStatus: props.paneStatus })} {...(props.asking === undefined ? {} : { asking: props.asking })} {...(props.typeInto === undefined ? {} : { typeInto: props.typeInto })} />
          : <NoChat {...props} availability={availability} />}
    </section>
  )
}

type NoChatProps = ChatPaneProps & { availability: Exclude<ChatAvailability, { kind: 'ready' }> }

/** A session that has no chat: why, what runs here, and the way to read its terminal log. */
function NoChat({ availability, process, onShowLog }: NoChatProps) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-3 text-center">
        <span className="flex size-10 items-center justify-center rounded-xl border border-line2 bg-raise text-dim" aria-hidden="true">
          <MessageSquare className="size-5" />
        </span>
        <h2 className="m-0 text-[15px] font-semibold text-fg">Chat view is for agent sessions</h2>
        <p className="m-0 text-[13px] leading-relaxed text-fg2">{noChatReason(availability)}</p>
        <p className="m-0 font-mono text-[12px] text-dim">Running here: {process}</p>
        <Button type="button" size="sm" onClick={onShowLog}>Show terminal log</Button>
      </div>
    </div>
  )
}
