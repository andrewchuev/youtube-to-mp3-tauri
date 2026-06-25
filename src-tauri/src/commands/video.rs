use std::{fs, path::{Path, PathBuf}, sync::Mutex};

use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use url::Url;
use uuid::Uuid;

use crate::{
    error::AppError,
    models::{CompletedOutput, Job, JobDto, JobStatus, PlaylistInfoDto, PlaylistTrackDto, VideoInfoDto},
    state::{lock_state, AppState},
};

const MAX_DURATION_SECONDS: i64 = 7200;
const MAX_ACTIVE_JOBS: usize = 2;
const MAX_PLAYLIST_TRACKS: usize = 100;

const ALLOWED_HOSTS: [&str; 5] = [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
];

struct SidecarOutput {
    stdout: String,
    stderr: String,
}

fn handle_job_failure(app: &AppHandle, job_id: &str, error: &AppError) {
    if let Ok(mut state) = app.state::<Mutex<AppState>>().lock() {
        state.set_job_failed(job_id, normalize_runtime_error(&error.to_string()));
    }
}

// ---- Commands ----

#[tauri::command]
pub async fn get_video_info(app: AppHandle, url: String) -> Result<VideoInfoDto, AppError> {
    let normalized = normalize_url(&url)?;
    extract_video_info(&app, &normalized).await
}

#[tauri::command]
pub fn list_jobs(state: State<'_, Mutex<AppState>>) -> Result<Vec<JobDto>, AppError> {
    Ok(lock_state(&state)?.list_jobs_dto())
}

#[tauri::command]
pub fn get_job(job_id: String, state: State<'_, Mutex<AppState>>) -> Result<JobDto, AppError> {
    lock_state(&state)?.get_job_dto(&job_id)
}

#[tauri::command]
pub fn clear_jobs(state: State<'_, Mutex<AppState>>) -> Result<(), AppError> {
    lock_state(&state)?.clear_completed_jobs();
    Ok(())
}

#[tauri::command]
pub async fn start_conversion(
    url: String,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<JobDto, AppError> {
    let normalized = normalize_url(&url)?;
    let info = extract_video_info(&app, &normalized).await?;

    let job_dto = {
        let mut state = lock_state(&state)?;

        if state.active_job_count() >= MAX_ACTIVE_JOBS {
            return Err(AppError::Validation(format!(
                "Too many active jobs. Current limit: {}.",
                MAX_ACTIVE_JOBS
            )));
        }
        if state.has_active_job_for_url(&normalized) {
            return Err(AppError::Validation(
                "A conversion job for this URL is already running.".to_string(),
            ));
        }

        let job = Job::new(
            Uuid::new_v4().simple().to_string(),
            normalized.clone(),
            Some(info.title.clone()),
            None,
            None,
        );
        let dto = job.to_dto();
        state.insert_job(job);
        dto
    };

    let job_id = job_dto.id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = process_job(&app, &job_id, &normalized, &info.title).await {
            handle_job_failure(&app, &job_id, &error);
        }
    });

    Ok(job_dto)
}

#[tauri::command]
pub async fn get_playlist_info(app: AppHandle, url: String) -> Result<PlaylistInfoDto, AppError> {
    let normalized = normalize_url(&url)?;
    fetch_playlist_info(&app, &normalized).await
}

#[tauri::command]
pub async fn start_playlist_conversion(
    url: String,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<JobDto>, AppError> {
    let normalized = normalize_url(&url)?;
    let playlist = fetch_playlist_info(&app, &normalized).await?;

    if playlist.tracks.is_empty() {
        return Err(AppError::Validation("Playlist is empty.".to_string()));
    }
    if playlist.tracks.len() > MAX_PLAYLIST_TRACKS {
        return Err(AppError::Validation(format!(
            "Playlist is too large. Maximum supported: {} tracks.",
            MAX_PLAYLIST_TRACKS
        )));
    }

    let (jobs, dtos) = {
        let mut state = lock_state(&state)?;

        if state.has_active_jobs() {
            return Err(AppError::Validation(
                "Finish active jobs before starting a playlist conversion.".to_string(),
            ));
        }

        let batch_id = Uuid::new_v4().simple().to_string();
        let album_subdir = sanitize_filename(&playlist.title);

        let jobs: Vec<Job> = playlist
            .tracks
            .iter()
            .map(|track| {
                Job::new(
                    Uuid::new_v4().simple().to_string(),
                    track.url.clone(),
                    Some(track.title.clone()),
                    Some(batch_id.clone()),
                    Some(album_subdir.clone()),
                )
            })
            .collect();

        let dtos: Vec<JobDto> = jobs.iter().map(Job::to_dto).collect();

        for job in &jobs {
            state.insert_job(job.clone());
        }

        (jobs, dtos)
    };

    let tasks: Vec<(String, String, String)> = jobs
        .iter()
        .map(|j| (j.id.clone(), j.url.clone(), j.title.clone().unwrap_or_default()))
        .collect();

    tauri::async_runtime::spawn(async move {
        // Process MAX_ACTIVE_JOBS tracks concurrently, then wait before starting the next batch.
        for chunk in tasks.chunks(MAX_ACTIVE_JOBS) {
            let handles: Vec<_> = chunk
                .iter()
                .map(|(job_id, url, title)| {
                    let app = app.clone();
                    let job_id = job_id.clone();
                    let url = url.clone();
                    let title = title.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = process_job(&app, &job_id, &url, &title).await {
                            handle_job_failure(&app, &job_id, &error);
                        }
                    })
                })
                .collect();

            for handle in handles {
                let _ = handle.await;
            }
        }
    });

    Ok(dtos)
}

// ---- Job processing ----

async fn process_job(app: &AppHandle, job_id: &str, url: &str, title: &str) -> Result<(), AppError> {
    app.state::<Mutex<AppState>>()
        .lock()
        .map_err(|_| AppError::LockPoisoned)?
        .set_job_status(job_id, JobStatus::Downloading)?;

    let source_path = download_source_audio(app, job_id, url).await?;

    app.state::<Mutex<AppState>>()
        .lock()
        .map_err(|_| AppError::LockPoisoned)?
        .set_job_status(job_id, JobStatus::Converting)?;

    let (output_dir, output_subdir) = {
        let state_handle = app.state::<Mutex<AppState>>();
        let state = state_handle.lock().map_err(|_| AppError::LockPoisoned)?;
        (state.output_dir().to_path_buf(), state.job_output_subdir(job_id))
    };

    let output_dir = match output_subdir {
        Some(ref subdir) => {
            let dir = output_dir.join(subdir);
            fs::create_dir_all(&dir)
                .map_err(|e| AppError::Validation(format!("Failed to create album folder: {e}")))?;
            dir
        }
        None => output_dir,
    };

    let file_name = format!("{}-{}.mp3", sanitize_filename(title), &job_id[..8]);
    let output_path = output_dir.join(&file_name);

    let convert_result = convert_to_mp3(app, &source_path, &output_path).await;
    let _ = fs::remove_file(&source_path);
    convert_result?;

    let file_size = fs::metadata(&output_path)
        .map_err(|e| AppError::Validation(format!("Failed to read output file metadata: {e}")))?
        .len();

    app.state::<Mutex<AppState>>()
        .lock()
        .map_err(|_| AppError::LockPoisoned)?
        .set_job_completed(job_id, CompletedOutput {
            file_name,
            file_path: output_path.to_string_lossy().into_owned(),
            file_size_bytes: file_size,
        })?;

    Ok(())
}

async fn download_source_audio(app: &AppHandle, job_id: &str, url: &str) -> Result<PathBuf, AppError> {
    let temp_dir = app
        .state::<Mutex<AppState>>()
        .lock()
        .map_err(|_| AppError::LockPoisoned)?
        .temp_dir()
        .to_path_buf();

    let output_template = temp_dir.join(format!("{job_id}.%(ext)s"));
    let output_template_str = output_template
        .to_str()
        .ok_or_else(|| AppError::Validation("Invalid temp path.".to_string()))?;

    let args = [
        "--no-playlist",
        "--no-progress",
        "-f",
        "bestaudio/best",
        "--output",
        output_template_str,
        "--print",
        "after_move:filepath",
        url,
    ];

    let output = run_sidecar(app, "yt-dlp", &args).await?;

    let path = output
        .stdout
        .lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty())
        .ok_or_else(|| AppError::Sidecar("yt-dlp did not return the downloaded file path.".to_string()))?;

    let file_path = PathBuf::from(path);
    if !file_path.exists() {
        return Err(AppError::Sidecar("Downloaded audio file is missing.".to_string()));
    }

    Ok(file_path)
}

async fn convert_to_mp3(app: &AppHandle, source_path: &Path, output_path: &Path) -> Result<(), AppError> {
    let src = source_path.to_string_lossy();
    let out = output_path.to_string_lossy();
    let args = ["-y", "-i", src.as_ref(), "-vn", "-codec:a", "libmp3lame", "-q:a", "2", out.as_ref()];
    run_sidecar(app, "ffmpeg", &args).await.map(|_| ())
}

async fn run_sidecar(app: &AppHandle, name: &str, args: &[&str]) -> Result<SidecarOutput, AppError> {
    let sidecar = app
        .shell()
        .sidecar(name)
        .map_err(|e| AppError::Sidecar(format!("Failed to prepare sidecar {name}: {e}")))?
        .args(args.iter().copied());

    let (mut rx, _child) = sidecar
        .spawn()
        .map_err(|e| AppError::Sidecar(format!("Failed to spawn sidecar {name}: {e}")))?;

    let mut stdout = Vec::<u8>::new();
    let mut stderr = Vec::<u8>::new();
    let mut exit_code = Some(0i32);

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => stdout.extend_from_slice(&bytes),
            CommandEvent::Stderr(bytes) => stderr.extend_from_slice(&bytes),
            CommandEvent::Error(message) => stderr.extend_from_slice(message.as_bytes()),
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
                break;
            }
            _ => {}
        }
    }

    let stdout_text = String::from_utf8_lossy(&stdout).trim().to_string();
    let stderr_text = String::from_utf8_lossy(&stderr).trim().to_string();

    if matches!(exit_code, Some(0) | None) {
        Ok(SidecarOutput { stdout: stdout_text, stderr: stderr_text })
    } else {
        let message = if !stderr_text.is_empty() { stderr_text } else { stdout_text };
        Err(AppError::Sidecar(normalize_runtime_error(&message)))
    }
}

// ---- URL and metadata helpers ----

fn normalize_url(url: &str) -> Result<String, AppError> {
    let trimmed = url.trim();
    let parsed = Url::parse(trimmed)
        .map_err(|_| AppError::Validation("Invalid URL".to_string()))?;

    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::Validation("Only http/https URLs are supported.".to_string()));
    }

    let host = parsed.host_str().unwrap_or_default().to_lowercase();
    if !ALLOWED_HOSTS.contains(&host.as_str()) {
        return Err(AppError::Validation("Only YouTube URLs are supported.".to_string()));
    }

    Ok(trimmed.to_string())
}

async fn extract_video_info(app: &AppHandle, url: &str) -> Result<VideoInfoDto, AppError> {
    let args = ["--dump-single-json", "--skip-download", "--no-warnings", "--no-playlist", url];
    let output = run_sidecar(app, "yt-dlp", &args).await?;
    let raw = if !output.stdout.is_empty() { output.stdout } else { output.stderr };

    let value: Value = serde_json::from_str(&raw)
        .map_err(|_| AppError::Validation("Unable to parse video metadata.".to_string()))?;

    if value.get("is_live").and_then(|v| v.as_bool()).unwrap_or(false) {
        return Err(AppError::Validation("Live streams are not supported.".to_string()));
    }

    let duration = value.get("duration").and_then(|v| v.as_i64());
    if let Some(secs) = duration {
        if secs > MAX_DURATION_SECONDS {
            return Err(AppError::Validation(format!(
                "Video is too long. Maximum supported duration is {} seconds.",
                MAX_DURATION_SECONDS
            )));
        }
    }

    Ok(VideoInfoDto {
        title: value
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown title")
            .to_string(),
        duration,
        thumbnail: value.get("thumbnail").and_then(|v| v.as_str()).map(str::to_string),
        uploader: value.get("uploader").and_then(|v| v.as_str()).map(str::to_string),
        webpage_url: value
            .get("webpage_url")
            .and_then(|v| v.as_str())
            .unwrap_or(url)
            .to_string(),
    })
}

async fn fetch_playlist_info(app: &AppHandle, url: &str) -> Result<PlaylistInfoDto, AppError> {
    let args = ["--flat-playlist", "--dump-single-json", "--no-warnings", url];
    let output = run_sidecar(app, "yt-dlp", &args).await?;
    let raw = if !output.stdout.is_empty() { output.stdout } else { output.stderr };

    let value: Value = serde_json::from_str(&raw)
        .map_err(|_| AppError::Validation("Unable to parse playlist metadata.".to_string()))?;

    if value.get("_type").and_then(|v| v.as_str()).unwrap_or("") != "playlist" {
        return Err(AppError::Validation(
            "URL is not a playlist or album. Use a playlist/album URL (e.g. music.youtube.com/playlist?list=...)."
                .to_string(),
        ));
    }

    let entries = value
        .get("entries")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::Validation("Playlist contains no tracks.".to_string()))?;

    let source_host = host_from_url(url);

    let tracks: Vec<PlaylistTrackDto> = entries
        .iter()
        .filter_map(|entry| {
            let title = entry
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown title")
                .to_string();

            let track_url = resolve_entry_url(entry, &source_host)?;

            let duration = entry.get("duration").and_then(|v| v.as_i64());
            if duration.is_some_and(|d| d > MAX_DURATION_SECONDS) {
                return None;
            }

            Some(PlaylistTrackDto { title, url: track_url, duration })
        })
        .collect();

    Ok(PlaylistInfoDto {
        title: value
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown playlist")
            .to_string(),
        uploader: value.get("uploader").and_then(|v| v.as_str()).map(str::to_string),
        thumbnail: value.get("thumbnail").and_then(|v| v.as_str()).map(str::to_string),
        webpage_url: value
            .get("webpage_url")
            .and_then(|v| v.as_str())
            .unwrap_or(url)
            .to_string(),
        tracks,
    })
}

fn host_from_url(url: &str) -> String {
    Url::parse(url)
        .map(|u| u.host_str().unwrap_or("youtube.com").to_lowercase())
        .unwrap_or_else(|_| "youtube.com".to_string())
}

fn resolve_entry_url(entry: &Value, source_host: &str) -> Option<String> {
    let base = if source_host.contains("music.youtube") {
        "https://music.youtube.com/watch?v="
    } else {
        "https://www.youtube.com/watch?v="
    };

    for field in &["webpage_url", "url"] {
        if let Some(raw) = entry.get(field).and_then(|v| v.as_str()) {
            if raw.starts_with("http") {
                return Some(raw.to_string());
            }
            if !raw.is_empty() && !raw.contains('/') {
                return Some(format!("{base}{raw}"));
            }
        }
    }

    entry
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|id| !id.is_empty())
        .map(|id| format!("{base}{id}"))
}

// ---- Pure utilities ----

fn normalize_runtime_error(message: &str) -> String {
    let lowered = message.to_lowercase();

    if lowered.contains("sign in to confirm") || lowered.contains("not a bot") {
        return "YouTube temporarily rejected the request. Try again later or use another video."
            .to_string();
    }
    if lowered.contains("video unavailable") {
        return "The video is unavailable or restricted.".to_string();
    }
    if lowered.contains("private video") {
        return "Private videos are not supported.".to_string();
    }
    if lowered.contains("members-only") || lowered.contains("members only") {
        return "Members-only videos are not supported.".to_string();
    }
    if lowered.contains("live stream") || lowered.contains("is_live") {
        return "Live streams are not supported.".to_string();
    }
    if lowered.contains("failed to prepare sidecar ffmpeg")
        || lowered.contains("failed to spawn sidecar ffmpeg")
    {
        return "FFmpeg sidecar is missing or could not be started.".to_string();
    }
    if lowered.contains("failed to prepare sidecar yt-dlp")
        || lowered.contains("failed to spawn sidecar yt-dlp")
    {
        return "yt-dlp sidecar is missing or could not be started.".to_string();
    }

    if message.trim().is_empty() {
        "Unknown command error.".to_string()
    } else {
        message.to_string()
    }
}

fn sanitize_filename(value: &str) -> String {
    let safe: String = value
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '_' { c } else { '-' })
        .collect();

    let deduped = safe
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    let trimmed = deduped.trim_matches(['-', '_']);

    if trimmed.is_empty() {
        "audio".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}
