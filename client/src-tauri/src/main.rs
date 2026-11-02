// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri;

mod app;
mod backend;
mod store;
mod tray;

/// Called from the frontend after a successful login so the Rust backend
/// can start (or restart) the Realtime subscription with fresh credentials.
#[tauri::command]
fn init_realtime() -> Result<(), String> {
    backend::handle_device_updates_api_call().map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            tray::init_tray(app.handle())?;
            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            app::start_app,
            app::run_command,
            store::get_store,
            store::set_store,
            init_realtime,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app_handle, _event| {});
}
