//! Which ticket sources each project reads, kept by the daemon in `<data folder>/ticket-links.json`
//! so every window of this computer (the desktop app, the terminal app) shows a project the same
//! tickets. A project is this computer's repository main checkout, so all its worktrees share one
//! link; another machine's folder is kept as that machine's client gave it. Nothing here is a
//! secret: the keys are `ticket_keys`'.

use super::usage_store::write_file;
use maitty_shared::ticket_links::{
    LinkedProject, RepoTicketFile, TICKET_LINKS_MAX, TicketLink, TicketLinkChange, TicketLinks, TicketMe, TicketPlace,
    is_link_folder, is_machine_name, trimmed_folder,
};
use maitty_shared::tickets::{TICKET_NAME_MAX_CHARS, TicketError, TicketKeyState, TicketProvider, clean_line};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const FILE: &str = "ticket-links.json";

/// What is kept on disk.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
struct Kept {
    #[serde(default)]
    projects: Vec<LinkedProject>,
    #[serde(default)]
    me: TicketMe,
}

pub(super) struct LinkStore {
    path: PathBuf,
}

impl LinkStore {
    pub(super) fn real() -> LinkStore {
        LinkStore::at(crate::config::data_dir().join(FILE))
    }

    pub(super) fn at(path: PathBuf) -> LinkStore {
        LinkStore { path }
    }

    /// What is kept. A file that is missing is nothing kept; one that can't be read or parsed is
    /// logged and read as nothing (a link is set up again in a moment), never an error that hides
    /// the tickets of every project. What is in it is checked as a client's words would be.
    fn load(&self) -> Kept {
        let text = match std::fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Kept::default(),
            Err(error) => {
                tracing::warn!("couldn't read the ticket links: {:?}", error.kind());
                return Kept::default();
            }
        };
        match serde_json::from_str::<Kept>(&text) {
            Ok(kept) => Kept {
                projects: kept.projects.into_iter().filter_map(checked_project).take(TICKET_LINKS_MAX).collect(),
                me: checked_me(kept.me),
            },
            Err(_) => {
                tracing::warn!("the ticket links file is not one this build reads; starting from none");
                Kept::default()
            }
        }
    }

    fn save(&self, kept: &Kept) -> Result<(), TicketError> {
        let bytes = serde_json::to_vec_pretty(kept).map_err(|_| unwritable())?;
        write_file(&self.path, &bytes).map_err(|error| {
            tracing::warn!("couldn't keep the ticket links: {}", error.root_cause().to_string().chars().take(100).collect::<String>());
            unwritable()
        })
    }
}

fn unwritable() -> TicketError {
    TicketError::Invalid("The ticket links could not be saved".into())
}

fn invalid(line: &str) -> TicketError {
    TicketError::Invalid(line.into())
}

fn checked_me(me: TicketMe) -> TicketMe {
    TicketMe { plane: clean_line(&me.plane, TICKET_NAME_MAX_CHARS), linear: clean_line(&me.linear, TICKET_NAME_MAX_CHARS) }
}

fn checked_place(place: TicketPlace) -> Result<TicketPlace, TicketError> {
    if place.machine.as_deref().is_some_and(|machine| !is_machine_name(machine)) {
        return Err(invalid("That machine name can't be kept"));
    }
    if !is_link_folder(&place.folder) {
        return Err(invalid("A project is kept under its full folder path"));
    }
    Ok(TicketPlace { machine: place.machine, folder: trimmed_folder(&place.folder).to_owned() })
}

fn checked_project(project: LinkedProject) -> Option<LinkedProject> {
    let place = checked_place(TicketPlace { machine: project.machine, folder: project.folder }).ok()?;
    let link = project.link.checked().ok()?;
    (!link.is_empty()).then_some(LinkedProject { machine: place.machine, folder: place.folder, link })
}

/// The project a place is: this computer's folder in a repository is its main checkout (the parent
/// of the common `.git`), so a worktree reads its repository's link; anything else is itself.
pub(super) fn project_of(place: TicketPlace, main_checkout: impl Fn(&Path) -> Option<PathBuf>) -> TicketPlace {
    if place.machine.is_some() {
        return place;
    }
    match main_checkout(Path::new(&place.folder)) {
        Some(root) => TicketPlace { machine: None, folder: trimmed_folder(&root.to_string_lossy()).to_owned() },
        None => place,
    }
}

/// This computer's repository main checkout of `folder`, or `None` outside git. Blocks (git).
pub(super) fn main_checkout(folder: &Path) -> Option<PathBuf> {
    if !folder.is_dir() {
        return None;
    }
    super::git::main_checkout(folder)
}

/// Reads a project root's ticket file: `None` when it has none, else its text or why not.
type ReadRepoFile = Box<dyn Fn(&Path) -> Option<Result<String, String>> + Send + Sync>;

/// Where the repository ticket files are read from, and the keys they are checked against.
pub(super) struct RepoFiles {
    read: ReadRepoFile,
    keys: Vec<TicketKeyState>,
}

impl RepoFiles {
    /// The files on disk, checked against the keys saved here. Blocks (the key folder).
    pub(super) fn real() -> RepoFiles {
        RepoFiles { read: Box::new(super::ticket_repo_file::read_text), keys: super::ticket_keys::KeyStore::real().states() }
    }

    #[cfg(test)]
    pub(super) fn fake(read: impl Fn(&Path) -> Option<Result<String, String>> + Send + Sync + 'static, keys: Vec<TicketKeyState>) -> RepoFiles {
        RepoFiles { read: Box::new(read), keys }
    }

    /// The asked project's link as it reads: `local` with its repository file filling what was not
    /// linked here, and what the file gave. Another machine's folder is not read from here.
    fn project(&self, place: &TicketPlace, local: TicketLink) -> (TicketLink, Option<RepoTicketFile>) {
        if place.machine.is_some() {
            return (local, None);
        }
        match (self.read)(Path::new(&place.folder)) {
            None => (local, None),
            Some(Err(why)) => (local, Some(RepoTicketFile { notes: vec![why], ..RepoTicketFile::default() })),
            Some(Ok(text)) => {
                let (link, report) = super::ticket_repo_file::merged(&local, super::ticket_repo_file::parse(&text, &self.keys));
                (link, Some(report))
            }
        }
    }
}

fn same_place(project: &LinkedProject, place: &TicketPlace) -> bool {
    project.machine == place.machine && project.folder == place.folder
}

/// Do `change` to what `store` keeps and answer as `Reply::TicketLinks` does: `place` resolved to
/// its project, every linked project, your names. Blocks (the file, git).
pub(super) fn change(
    store: &LinkStore,
    place: Option<TicketPlace>,
    change: TicketLinkChange,
    main_checkout: impl Fn(&Path) -> Option<PathBuf>,
    repo_files: &RepoFiles,
) -> Result<TicketLinks, TicketError> {
    let mut kept = store.load();
    let resolve = |place: TicketPlace| checked_place(place).map(|place| project_of(place, &main_checkout));
    let asked = place.map(resolve).transpose()?;
    let before = kept.clone();
    match change {
        TicketLinkChange::Read => {}
        TicketLinkChange::Set { place, link } => {
            let place = resolve(place)?;
            let link = link.checked().map_err(|line| invalid(&line))?;
            kept.projects.retain(|project| !same_place(project, &place));
            if !link.is_empty() {
                if kept.projects.len() >= TICKET_LINKS_MAX {
                    return Err(invalid("Too many projects are linked; unlink one first"));
                }
                kept.projects.push(LinkedProject { machine: place.machine, folder: place.folder, link });
            }
        }
        TicketLinkChange::Unlink { place } => {
            let place = resolve(place)?;
            kept.projects.retain(|project| !same_place(project, &place));
        }
        TicketLinkChange::SetMe { provider, name } => {
            let name = clean_line(&name, TICKET_NAME_MAX_CHARS);
            match provider {
                TicketProvider::Plane => kept.me.plane = name,
                TicketProvider::Linear => kept.me.linear = name,
            }
        }
        TicketLinkChange::Import { projects, me } => {
            for project in projects.into_iter().filter_map(checked_project) {
                let place = project_of(TicketPlace { machine: project.machine, folder: project.folder }, &main_checkout);
                let known = kept.projects.iter().any(|kept| same_place(kept, &place));
                if !known && kept.projects.len() < TICKET_LINKS_MAX {
                    kept.projects.push(LinkedProject { machine: place.machine, folder: place.folder, link: project.link });
                }
            }
            let me = checked_me(me);
            if kept.me.plane.is_empty() {
                kept.me.plane = me.plane;
            }
            if kept.me.linear.is_empty() {
                kept.me.linear = me.linear;
            }
        }
    }
    if kept != before {
        store.save(&kept)?;
    }
    let mut repo_file = None;
    let project = asked.map(|place| {
        let local = kept.projects.iter().find(|project| same_place(project, &place)).map(|project| project.link.clone()).unwrap_or_default();
        let (link, file) = repo_files.project(&place, local);
        repo_file = file;
        LinkedProject { machine: place.machine, folder: place.folder, link }
    });
    let mut projects = kept.projects;
    projects.sort_by(|a, b| (&a.machine, &a.folder).cmp(&(&b.machine, &b.folder)));
    Ok(TicketLinks { project, projects, me: kept.me, repo_file })
}

#[cfg(test)]
mod tests {
    use super::*;
    use maitty_shared::ticket_links::{GitHubLink, TicketPick};

    fn no_files() -> RepoFiles {
        RepoFiles::fake(|_| None, Vec::new())
    }

    fn store() -> (LinkStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!("maitty-ticket-links-{}-{}", std::process::id(), rand_suffix()));
        std::fs::create_dir_all(&dir).unwrap();
        (LinkStore::at(dir.join(FILE)), dir)
    }

    fn rand_suffix() -> u64 {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        NEXT.fetch_add(1, Ordering::Relaxed)
    }

    fn here(folder: &str) -> TicketPlace {
        TicketPlace { machine: None, folder: folder.into() }
    }

    /// `/repo` is a repository whose worktree is `/wt/feature`; anything else is outside git.
    fn checkout(folder: &Path) -> Option<PathBuf> {
        match folder.to_str()? {
            "/repo" | "/repo/src" | "/wt/feature" => Some(PathBuf::from("/repo")),
            _ => None,
        }
    }

    fn linear(id: &str) -> Option<TicketPick> {
        Some(TicketPick { id: id.into(), name: "Team".into() })
    }

    #[test]
    fn a_link_set_in_a_worktree_is_its_repositorys_and_survives_a_restart() {
        let (store, dir) = store();
        let link = TicketLink { linear: linear("linear:team.1"), ..TicketLink::default() };
        let set = TicketLinkChange::Set { place: here("/wt/feature"), link: link.clone() };
        let answer = change(&store, Some(here("/wt/feature")), set, checkout, &no_files()).unwrap();
        let project = answer.project.unwrap();
        assert_eq!(project.folder, "/repo", "a worktree is its repository's main checkout");
        assert_eq!(project.link, link);
        // A session in the main checkout, or deeper in it, reads the same link, from the file.
        let again = change(&LinkStore::at(dir.join(FILE)), Some(here("/repo/src")), TicketLinkChange::Read, checkout, &no_files()).unwrap();
        assert_eq!(again.project.unwrap().link, link);
        assert_eq!(again.projects.len(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn projects_are_kept_apart_and_unlinking_forgets_one() {
        let (store, dir) = store();
        let shop = TicketLink { github: GitHubLink::Repo("me/shop".into()), ..TicketLink::default() };
        let blog = TicketLink { github: GitHubLink::Off, linear: linear("linear:team.2"), ..TicketLink::default() };
        change(&store, None, TicketLinkChange::Set { place: here("/shop"), link: shop.clone() }, checkout, &no_files()).unwrap();
        change(&store, None, TicketLinkChange::Set { place: here("/blog/"), link: blog.clone() }, checkout, &no_files()).unwrap();
        let there = TicketPlace { machine: Some("kingdom".into()), folder: "/home/me/shop".into() };
        change(&store, None, TicketLinkChange::Set { place: there.clone(), link: blog.clone() }, checkout, &no_files()).unwrap();
        let shop_now = change(&store, Some(here("/shop")), TicketLinkChange::Read, checkout, &no_files()).unwrap();
        assert_eq!(shop_now.project.unwrap().link, shop, "each project reads its own sources");
        let blog_now = change(&store, Some(here("/blog")), TicketLinkChange::Read, checkout, &no_files()).unwrap();
        assert_eq!(blog_now.project.unwrap().link, blog, "a trailing separator is the same folder");
        let gone = change(&store, Some(here("/shop")), TicketLinkChange::Unlink { place: here("/shop") }, checkout, &no_files()).unwrap();
        assert_eq!(gone.project.unwrap().link, TicketLink::default(), "an unlinked project follows its origin again");
        assert_eq!(gone.projects.len(), 2);
        assert_eq!(gone.projects.iter().filter(|project| project.machine.is_some()).count(), 1, "another machine's folder is its own");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn what_is_refused_is_never_kept() {
        let (store, dir) = store();
        let bad_repo = TicketLink { github: GitHubLink::Repo("../etc".into()), ..TicketLink::default() };
        assert!(change(&store, None, TicketLinkChange::Set { place: here("/shop"), link: bad_repo }, checkout, &no_files()).is_err());
        assert!(change(&store, None, TicketLinkChange::Set { place: here("relative"), link: TicketLink::default() }, checkout, &no_files()).is_err());
        let bad_machine = TicketPlace { machine: Some("a\nb".into()), folder: "/x".into() };
        assert!(change(&store, None, TicketLinkChange::Unlink { place: bad_machine }, checkout, &no_files()).is_err());
        assert!(!dir.join(FILE).exists(), "nothing was written");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn importing_adds_only_what_is_not_kept_yet() {
        let (store, dir) = store();
        let mine = TicketLink { linear: linear("linear:team.1"), ..TicketLink::default() };
        change(&store, None, TicketLinkChange::Set { place: here("/repo"), link: mine.clone() }, checkout, &no_files()).unwrap();
        change(&store, None, TicketLinkChange::SetMe { provider: TicketProvider::Plane, name: "Ada".into() }, checkout, &no_files()).unwrap();
        let old = vec![
            LinkedProject { machine: None, folder: "/wt/feature".into(), link: TicketLink { github: GitHubLink::Off, ..TicketLink::default() } },
            LinkedProject { machine: None, folder: "/other".into(), link: TicketLink { github: GitHubLink::Repo("me/other".into()), ..TicketLink::default() } },
            LinkedProject { machine: None, folder: "/empty".into(), link: TicketLink::default() },
        ];
        let me = TicketMe { plane: "Old".into(), linear: "Lin".into() };
        let answer = change(&store, None, TicketLinkChange::Import { projects: old, me }, checkout, &no_files()).unwrap();
        assert_eq!(answer.projects.len(), 2, "the repository kept its link; an empty one is not kept");
        assert_eq!(answer.projects.iter().find(|project| project.folder == "/repo").unwrap().link, mine);
        assert_eq!(answer.me, TicketMe { plane: "Ada".into(), linear: "Lin".into() }, "a name already set stays");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_damaged_file_reads_as_no_links() {
        let (store, dir) = store();
        std::fs::write(dir.join(FILE), b"{ not json").unwrap();
        let answer = change(&store, Some(here("/shop")), TicketLinkChange::Read, checkout, &no_files()).unwrap();
        assert!(answer.projects.is_empty());
        assert_eq!(answer.project.unwrap().link, TicketLink::default());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_repository_file_fills_what_was_not_linked_here_and_says_so() {
        let (store, dir) = store();
        let files = RepoFiles::fake(
            |root| (root == Path::new("/repo")).then(|| Ok("github = \"acme/shop\"\n[linear]\nteam = \"t9\"\n".to_string())),
            Vec::new(),
        );
        let mine = TicketLink { linear: linear("linear:team.1"), ..TicketLink::default() };
        change(&store, None, TicketLinkChange::Set { place: here("/repo"), link: mine }, checkout, &no_files()).unwrap();
        let answer = change(&store, Some(here("/wt/feature")), TicketLinkChange::Read, checkout, &files).unwrap();
        let link = answer.project.unwrap().link;
        assert_eq!(link.github, GitHubLink::Repo("acme/shop".into()), "the file fills GitHub, which was not set here");
        assert_eq!(link.linear.unwrap().id, "linear:team.1", "the team linked here wins");
        let file = answer.repo_file.unwrap();
        assert!(file.github && !file.linear && !file.plane);
        assert_eq!(answer.projects[0].link.github, GitHubLink::Origin, "what is kept is only what was linked here");
        let other = change(&store, Some(here("/other")), TicketLinkChange::Read, checkout, &files).unwrap();
        assert_eq!(other.repo_file, None, "a folder with no file has nothing from one");
        let broken = RepoFiles::fake(|_| Some(Err("too big".into())), Vec::new());
        let said = change(&store, Some(here("/repo")), TicketLinkChange::Read, checkout, &broken).unwrap();
        assert_eq!(said.repo_file.unwrap().notes, ["too big"]);
        let there = TicketPlace { machine: Some("kingdom".into()), folder: "/repo".into() };
        assert_eq!(change(&store, Some(there), TicketLinkChange::Read, checkout, &files).unwrap().repo_file, None, "another machine's folder is not read here");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
