mod commands;
mod error;
mod models;
mod state;
mod util;

use std::sync::Mutex;

use tauri::Manager;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory");

            let download_dir = app
                .path()
                .download_dir()
                .unwrap_or_else(|_| app_data_dir.join("downloads"));

            let state = AppState::new(app_data_dir, download_dir)
                .expect("failed to initialize application state");

            app.manage(Mutex::new(state));
            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::video::get_video_info,
            commands::video::start_conversion,
            commands::video::get_job,
            commands::video::list_jobs,
            commands::video::clear_jobs,
            commands::video::get_playlist_info,
            commands::video::start_playlist_conversion,
            commands::settings::get_settings,
            commands::settings::set_output_dir,
            commands::settings::reset_output_dir,
            commands::settings::open_output_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
