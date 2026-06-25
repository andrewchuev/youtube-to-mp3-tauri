use serde::Serialize;

use crate::util::now_ts;

// ---- Serializable DTOs sent to the frontend ----

#[derive(Debug, Clone, Serialize)]
pub struct VideoInfoDto {
    pub title: String,
    pub duration: Option<i64>,
    pub thumbnail: Option<String>,
    pub uploader: Option<String>,
    pub webpage_url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlaylistTrackDto {
    pub title: String,
    pub url: String,
    pub duration: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlaylistInfoDto {
    pub title: String,
    pub uploader: Option<String>,
    pub thumbnail: Option<String>,
    pub webpage_url: String,
    pub tracks: Vec<PlaylistTrackDto>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppSettingsDto {
    pub output_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JobStatusDto {
    Queued,
    Downloading,
    Converting,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct JobDto {
    pub id: String,
    pub url: String,
    pub title: Option<String>,
    pub status: JobStatusDto,
    pub created_at: i64,
    pub updated_at: i64,
    pub error: Option<String>,
    pub output_file_name: Option<String>,
    pub output_file_path: Option<String>,
    pub file_size_bytes: Option<u64>,
    pub batch_id: Option<String>,
    pub output_subdir: Option<String>,
}

// ---- Internal job representation (not serialized) ----

#[derive(Debug, Clone)]
pub struct CompletedOutput {
    pub file_name: String,
    pub file_path: String,
    pub file_size_bytes: u64,
}

#[derive(Debug, Clone)]
pub enum JobStatus {
    Queued,
    Downloading,
    Converting,
    Completed(CompletedOutput),
    Failed { error: String },
}

impl JobStatus {
    pub fn is_active(&self) -> bool {
        matches!(self, Self::Queued | Self::Downloading | Self::Converting)
    }
}

#[derive(Debug, Clone)]
pub struct Job {
    pub id: String,
    pub url: String,
    pub title: Option<String>,
    pub status: JobStatus,
    pub created_at: i64,
    pub updated_at: i64,
    pub batch_id: Option<String>,
    pub output_subdir: Option<String>,
}

impl Job {
    pub fn new(
        id: String,
        url: String,
        title: Option<String>,
        batch_id: Option<String>,
        output_subdir: Option<String>,
    ) -> Self {
        let now = now_ts();
        Self {
            id,
            url,
            title,
            status: JobStatus::Queued,
            created_at: now,
            updated_at: now,
            batch_id,
            output_subdir,
        }
    }

    pub fn to_dto(&self) -> JobDto {
        let (status, error, file_name, file_path, file_size) = match &self.status {
            JobStatus::Queued => (JobStatusDto::Queued, None, None, None, None),
            JobStatus::Downloading => (JobStatusDto::Downloading, None, None, None, None),
            JobStatus::Converting => (JobStatusDto::Converting, None, None, None, None),
            JobStatus::Completed(out) => (
                JobStatusDto::Completed,
                None,
                Some(out.file_name.clone()),
                Some(out.file_path.clone()),
                Some(out.file_size_bytes),
            ),
            JobStatus::Failed { error } => (JobStatusDto::Failed, Some(error.clone()), None, None, None),
        };

        JobDto {
            id: self.id.clone(),
            url: self.url.clone(),
            title: self.title.clone(),
            status,
            created_at: self.created_at,
            updated_at: self.updated_at,
            error,
            output_file_name: file_name,
            output_file_path: file_path,
            file_size_bytes: file_size,
            batch_id: self.batch_id.clone(),
            output_subdir: self.output_subdir.clone(),
        }
    }
}
