#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod files;
mod git;
mod plans;
mod pty;
mod rpc;
mod sessions;
mod sysinfo;

fn main() {
    // Os plugins de E2E só existem no binário de teste (`--features e2e`).
    // Registrá-los sempre deixaria um servidor WebDriver embutido em produção.
    #[cfg(feature = "e2e")]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(not(feature = "e2e"))]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .manage(rpc::RpcState::default())
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            rpc::start_session,
            rpc::send_prompt,
            rpc::rpc_command,
            rpc::running_sessions,
            rpc::stop_session,
            sessions::list_sessions,
            sessions::list_children,
            sessions::read_session_messages,
            sessions::read_image_data,
            sessions::search_sessions,
            sessions::session_edits,
            sessions::session_model,
            sessions::pi_models,
            sessions::delete_session,
            sessions::kill_orphans,
            sessions::hooks_status,
            sessions::hooks_install,
            sessions::hooks_remove,
            sessions::hooks_tail,
            sessions::compaction_get,
            sessions::compaction_set,
            sessions::home_dir,
            sessions::debug_flags,
            sessions::debug_note,
            sessions::pi_version,
            sessions::pi_update,
            sessions::pi_list,
            sessions::pi_mcp_list,
            sessions::pi_install,
            sessions::pi_remove,
            sessions::pi_mcp_add,
            sessions::pi_mcp_remove,
            sessions::app_version,
            sessions::app_info,
            sessions::open_external,
            sessions::open_file,
            files::project_files,
            files::read_text_file,
            sessions::revert_hunk,
            sessions::missions_status,
            sessions::copy_text,
            sessions::auth_status,
            sessions::auth_providers,
            sessions::auth_logout,
            sessions::usage_stats,
            sessions::models_provider_remove,
            sysinfo::mem_usage,
            sessions::pick_directory,
            sessions::pick_file,
            sessions::paste_image,
            sessions::open_terminal_login,
            git::git_status,
            git::git_file_diff,
            git::git_commit,
            git::git_discard,
            git::git_stash,
            git::git_stash_pop,
            git::git_pull,
            git::git_push,
            plans::plans_list
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                use tauri::Manager;
                window.state::<rpc::RpcState>().kill_all();
                window.state::<pty::PtyState>().kill_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to start tauri");
}
