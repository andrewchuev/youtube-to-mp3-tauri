use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

use crate::{
    error::AppError,
    models::{AppSettingsDto, CompletedOutput, Job, JobDto, JobStatus},
    util::now_ts,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredSettings {
    output_dir: String,
}

pub struct AppState {
    settings_path: PathBuf,
    temp_dir: PathBuf,
    default_output_dir: PathBuf,
    output_dir: PathBuf,
    jobs: HashMap<String, Job>,
}

impl AppState {
    pub fn new(app_data_dir: PathBuf, download_dir: PathBuf) -> Result<Self, AppError> {
        let temp_dir = app_data_dir.join("temp");
        let settings_path = app_data_dir.join("settings.json");
        let default_output_dir = download_dir.join("YTMP3 Desktop");

        fs::create_dir_all(&app_data_dir)?;
        fs::create_dir_all(&temp_dir)?;
        fs::create_dir_all(&default_output_dir)?;

        let output_dir =
            Self::load_output_dir(&settings_path).unwrap_or_else(|| default_output_dir.clone());

        fs::create_dir_all(&output_dir)?;

        Ok(Self {
            settings_path,
            temp_dir,
            default_output_dir,
            output_dir,
            jobs: HashMap::new(),
        })
    }

    pub fn temp_dir(&self) -> &Path {
        &self.temp_dir
    }

    pub fn output_dir(&self) -> &Path {
        &self.output_dir
    }

    pub fn settings_dto(&self) -> AppSettingsDto {
        AppSettingsDto {
            output_dir: self.output_dir.to_string_lossy().into_owned(),
        }
    }

    pub fn insert_job(&mut self, job: Job) {
        self.jobs.insert(job.id.clone(), job);
    }

    pub fn get_job_dto(&self, id: &str) -> Result<JobDto, AppError> {
        self.jobs.get(id).map(Job::to_dto).ok_or(AppError::JobNotFound)
    }

    pub fn list_jobs_dto(&self) -> Vec<JobDto> {
        let mut jobs: Vec<JobDto> = self.jobs.values().map(Job::to_dto).collect();
        jobs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        jobs
    }

    pub fn job_output_subdir(&self, job_id: &str) -> Option<String> {
        self.jobs.get(job_id)?.output_subdir.clone()
    }

    pub fn active_job_count(&self) -> usize {
        self.jobs.values().filter(|j| j.status.is_active()).count()
    }

    pub fn has_active_jobs(&self) -> bool {
        self.jobs.values().any(|j| j.status.is_active())
    }

    pub fn has_active_job_for_url(&self, url: &str) -> bool {
        self.jobs.values().any(|j| j.status.is_active() && j.url.trim() == url)
    }

    pub fn set_job_status(&mut self, job_id: &str, status: JobStatus) -> Result<(), AppError> {
        let job = self.jobs.get_mut(job_id).ok_or(AppError::JobNotFound)?;
        job.status = status;
        job.updated_at = now_ts();
        Ok(())
    }

    pub fn set_job_completed(&mut self, job_id: &str, output: CompletedOutput) -> Result<(), AppError> {
        let job = self.jobs.get_mut(job_id).ok_or(AppError::JobNotFound)?;
        job.status = JobStatus::Completed(output);
        job.updated_at = now_ts();
        Ok(())
    }

    pub fn set_job_failed(&mut self, job_id: &str, error: String) {
        if let Some(job) = self.jobs.get_mut(job_id) {
            job.status = JobStatus::Failed { error };
            job.updated_at = now_ts();
        }
    }

    // Only removes terminal jobs; active jobs are left running.
    pub fn clear_completed_jobs(&mut self) {
        self.jobs.retain(|_, job| job.status.is_active());
    }

    pub fn set_output_dir(&mut self, path: PathBuf) -> Result<AppSettingsDto, AppError> {
        fs::create_dir_all(&path)?;
        self.output_dir = path;
        self.save_settings()?;
        Ok(self.settings_dto())
    }

    pub fn reset_output_dir(&mut self) -> Result<AppSettingsDto, AppError> {
        let default = self.default_output_dir.clone();
        fs::create_dir_all(&default)?;
        self.output_dir = default;
        self.save_settings()?;
        Ok(self.settings_dto())
    }

    fn load_output_dir(settings_path: &Path) -> Option<PathBuf> {
        let raw = fs::read_to_string(settings_path).ok()?;
        let stored: StoredSettings = serde_json::from_str(&raw).ok()?;
        let trimmed = stored.output_dir.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    }

    fn save_settings(&self) -> Result<(), AppError> {
        let stored = StoredSettings {
            output_dir: self.output_dir.to_string_lossy().into_owned(),
        };
        let serialized = serde_json::to_string_pretty(&stored)?;
        fs::write(&self.settings_path, serialized)?;
        Ok(())
    }
}

pub fn lock_state(mutex: &Mutex<AppState>) -> Result<std::sync::MutexGuard<'_, AppState>, AppError> {
    mutex.lock().map_err(|_| AppError::LockPoisoned)
}
