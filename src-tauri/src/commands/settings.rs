use std::{path::PathBuf, sync::Mutex};

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::{error::AppError, models::AppSettingsDto, state::{lock_state, AppState}};

#[tauri::command]
pub fn get_settings(state: State<'_, Mutex<AppState>>) -> Result<AppSettingsDto, AppError> {
    Ok(lock_state(&state)?.settings_dto())
}

#[tauri::command]
pub fn set_output_dir(
    path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<AppSettingsDto, AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Output folder path is empty.".to_string()));
    }
    lock_state(&state)?.set_output_dir(PathBuf::from(trimmed))
}

#[tauri::command]
pub fn reset_output_dir(state: State<'_, Mutex<AppState>>) -> Result<AppSettingsDto, AppError> {
    lock_state(&state)?.reset_output_dir()
}

#[tauri::command]
pub fn open_output_dir(app: AppHandle, state: State<'_, Mutex<AppState>>) -> Result<(), AppError> {
    let output_dir = lock_state(&state)?.output_dir().to_path_buf();
    app.opener()
        .open_path(output_dir.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|e| AppError::Validation(format!("Failed to open output folder: {e}")))
}
