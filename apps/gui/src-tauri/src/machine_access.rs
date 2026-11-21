//! How a person changes the user a machine connects as from the window, without a terminal. Keys
//! and host keys are the person's own ssh setup (ADR 0017): ssh records a new host key itself and
//! refuses a changed one (`maitty_machines::new_host_keys`). The work is in `maitty_machines`; here
//! it is run off the UI thread and tied to a machine by name.

use maitty_machines::local_machines::{config_path, machines_beside};
use maitty_machines::machine_config::set_target;
use maitty_machines::machine_target::{build_target, split_target, valid_user};

/// The ssh target of the machine called `name`.
fn target_of(wire: &crate::terminal_stream::Wire, name: &str) -> Result<String, String> {
    let handle = wire.handle()?;
    let id = handle
        .id_of(name)
        .ok_or_else(|| format!("{name} is not one of this computer's machines"))?;
    let route = handle
        .route(id)
        .ok_or_else(|| format!("{name} is no longer in the list"))?;
    let (_, target) = route
        .ssh_parts()
        .ok_or_else(|| format!("{name} is not reached over ssh"))?;
    Ok(target.to_string())
}

/// The user name this computer's ssh would connect as when a machine names none.
#[tauri::command]
pub fn local_user_name() -> Option<String> {
    ["USER", "USERNAME", "LOGNAME"]
        .iter()
        .find_map(|key| std::env::var(key).ok())
        .filter(|user| valid_user(user))
}

/// Set the user a machine connects as (blank: none), and dial it again as that user. The entry in
/// `config.local.toml` is rewritten first, its other keys left as they are; the machine is then
/// stopped and started from the entry, so its sessions are shown again once it connects.
#[tauri::command]
pub async fn set_machine_user(wire: tauri::State<'_, crate::terminal_stream::Wire>, name: String, user: String) -> Result<(), String> {
    let target = target_of(&wire, &name)?;
    let (_, host) = split_target(&target);
    let new_target = build_target(&user, host)?;
    let file = config_path().with_file_name("config.local.toml");
    let entry = name.clone();
    let def = tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
        if !set_target(&file, &entry, &new_target).map_err(|error| format!("Could not change {entry}: {error:#}"))? {
            return Err(format!("{entry} is not in config.local.toml"));
        }
        machines_beside(&config_path())
            .machines
            .into_iter()
            .find(|def| def.name.eq_ignore_ascii_case(&entry))
            .ok_or_else(|| format!("{entry} is not in config.local.toml"))
    })
    .await
    .map_err(|error| format!("Could not change {name}: {error}"))??;
    let handle = wire.handle()?;
    handle.remove(&name);
    handle.add(def);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_local_user_name_is_only_one_ssh_could_use() {
        assert!(local_user_name().is_none_or(|user| valid_user(&user)));
    }
}
