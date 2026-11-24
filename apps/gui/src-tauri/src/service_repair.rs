//! The host side of Settings › Updates & repair for the local service. These calls never go through the service's
//! protocol, so they work when the service is old, stale, wedged or not running.

use std::path::PathBuf;

/// The daemon file brought up to this app's release right now. Unlike `daemon_executable`, which remembers its first
/// answer, this looks at the file again, so a repair after a failed or skipped install replaces it.
pub fn current_daemon_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bundled = crate::bundled_daemon(app)?;
    if cfg!(debug_assertions) {
        return Ok(bundled);
    }
    let version = app.package_info().version.to_string();
    maitty_desktop_client::ensure_shared_daemon(&bundled, &version).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub async fn local_service_report(app: tauri::AppHandle) -> serde_json::Value {
    maitty_desktop_client::local_service_report(&app.package_info().version.to_string()).await
}

/// Replace the daemon file, stop the running service (saving its sessions first) and start the new one.
#[tauri::command]
pub async fn repair_local_service(app: tauri::AppHandle, discard_unsaved: bool) -> Result<serde_json::Value, String> {
    let handle = app.clone();
    let file = tauri::async_runtime::spawn_blocking(move || current_daemon_file(&handle))
        .await
        .map_err(|error| format!("The repair stopped unexpectedly: {error}"))??;
    maitty_desktop_client::repair_local_service(&file, &app.package_info().version.to_string(), discard_unsaved)
        .await
        .map_err(|error| format!("{error:#}"))
}
