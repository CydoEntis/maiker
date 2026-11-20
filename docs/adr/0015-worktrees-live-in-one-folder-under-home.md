# 0015. Worktrees live in one folder under home, named for the task

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

Worktrees Maiker made went next to the repository, in `<repo_parent>/<repo>-worktrees/<branch>`
(`C:\dev\chameleon-worktrees\warm-finch`). That put a second folder beside every project, in
whatever folder holds the projects, and worktrees of many repositories were scattered through the
disk. A branch name was a made-up two-word name unless the person typed one, so a list of
worktrees said nothing about what each was for.

## Decision

- **One central folder.** A new worktree is made at
  `<home>/.<command>/worktrees/<project>/<name>`, where `.<command>` is the app's folder in the
  home directory (`.maiker`, from `brand::APP_COMMAND`, so a rename changes it with the rest,
  ADR 0012), `<project>` is the repository's folder name and `<name>` is the worktree's folder.
  The default of `[worktree] dir` is that path as a template (`{home}`, `{project}` and `{branch}`
  join `{repo}` and `{repo_parent}`); a `dir` a person set keeps working as written.
- **A project folder is one repository's.** The first repository to use a project name leaves a
  small note (`.repo`, its path) in it. A different repository with the same folder name gets
  `<project>-<six hex digits of a hash of its path>`, which stays the same every time. The note
  goes with the folder when its last worktree is removed.
- **Safe, short names.** Every part is made safe on Windows (`<>:"/\|?*` and control characters
  become `-`, no trailing dot or space, no device name such as `CON`, never `..`) and cut: 40
  characters for the project, 64 for the worktree. A name that had to be cut keeps a hash of the
  whole, so two long names stay apart.
- **Named for the task.** The desktop app names a new worktree's branch (and so its folder) from
  what the session is working on: its title, else its last prompt, as at most four ASCII words and
  32 characters (`fix-login-redirect`), `-2`, `-3` when taken. With nothing usable it falls back to the
  made-up two-word name. A name the person types is used as typed (the folder is that name made
  safe, as before).
- **Existing worktrees stay where they are.** Nothing moves them. Everything that lists, merges,
  removes, tidies or recreates a worktree finds it through `git worktree list` or the folder the
  app recorded, so the old sibling folders and the central ones are handled alike.

## Alternatives considered

- **Keep them next to the repository.** It litters the folder that holds the projects, and finding
  every worktree means knowing every project.
- **Inside each repository's `.maiker` folder.** Short paths, and the worktree stays with its
  repository, but it nests a checkout inside another checkout: every repository would need a
  gitignore entry for it, and tools that walk the repository (search, file watchers, a build) would
  walk the worktrees too.
- **A hash of the path for every project.** Never collides, but nobody can tell the folders apart.
  Only a real collision gets a suffix.
- **Move the existing worktrees.** A move breaks the folders agents are running in and the paths
  git and Claude have recorded; the old ones are few and go away as they are merged.

## Consequences

- Worktrees are away from the repository, so a relative path from one to the other (`../shared`)
  no longer works. A setup hook that needs the main checkout finds it through git.
- Claude keeps a conversation under a folder named after the path it ran in, so a conversation
  resumed in a worktree must be looked for under the worktree's own folder. `copy_claude_transcript`
  already copies a conversation into the new folder when a chat moves into a worktree, and the
  resume check reads the worktree's folder, not the repository's.
- The first worktree of a repository creates `~/.maiker/worktrees/<project>`. A machine with no
  home folder asks for `[worktree] dir` to be set.
- Deep paths: the central folder adds the home path and two names to every file in a worktree; the
  cuts above keep a Windows path well inside its limit.
- Revisit if people want the folder somewhere else often (a setting rather than a template), or if
  the project note proves fragile.
